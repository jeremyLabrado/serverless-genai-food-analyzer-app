import {
  Stack,
  aws_lambda as lambda,
  aws_s3 as s3,
  aws_dynamodb as dynamodb,
  aws_cloudfront_origins as origins,
  aws_cloudfront as cloudfront,
  aws_iam as iam,
  aws_cloudtrail as cloudtrail,
  CfnOutput,
  Duration,
  Aws,
  aws_s3_deployment as s3deploy,
  aws_lambda_nodejs as nodejs,
  Fn,
  aws_secretsmanager as secretsmanager,
  SecretValue,
  StackProps,  
  DockerImage,
} from "aws-cdk-lib";
import { IFunction, Tracing } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { IUserPool } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import * as path from "path";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AddBehaviorOptions } from "aws-cdk-lib/aws-cloudfront";
import * as cdk from "aws-cdk-lib";
import { FoodAnalyzerDashBoard } from "./dashboard";
import { Auth } from "./auth";
import { TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { LoadDatabase } from "./load-database-construct";
import {
  ExecSyncOptionsWithBufferEncoding,
  execSync,
} from "node:child_process";
import { Utils } from "./utils";
import { NagSuppressions } from "cdk-nag";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";

export class FoodAnalyzerStack extends Stack {
  public userPool: IUserPool;
  public generateImage: IFunction;
  public generateRecipe: IFunction;
  public getImageIngredients: IFunction;
  public getIngredients: IFunction;
  public getStepsRecipe: IFunction;
  public productSummary: IFunction;
  constructor(scope: Construct, id: string, stage: string, props: StackProps) {
    super(scope, id, props);

    // Add cost allocation tags
    cdk.Tags.of(this).add('Application', 'FoodAnalyzer');
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('CostCenter', 'Prototyping');
    cdk.Tags.of(this).add('Owner', 'energy-utilities-france');
    cdk.Tags.of(this).add('Project', 'SmartGroceries');

    const powerToolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "powertools-layer",
      `arn:aws:lambda:${
        Stack.of(this).region
      }:017000801446:layer:AWSLambdaPowertoolsPythonV2:60`
    );

    const powerToolsTypeScriptLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "powertools-layer-ts",
      `arn:aws:lambda:${
        Stack.of(this).region
      }:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:2`
    );

    const openFoodFactsProductsTable = new dynamodb.Table(this, "allProductsOpenFoodFactsTable", {
      partitionKey: {
        name: "product_code",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
    });

    new CfnOutput(this, "openFoodFactsProductsTableNameOutput", {
      value: openFoodFactsProductsTable.tableName,
    });
    

    const productsTable = new dynamodb.Table(this, "ProductsTable", {
      partitionKey: {
        name: "product_code",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "language", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
    });

    const productsSummaryTable = new dynamodb.Table(
      this,
      "ProductsSummaryTable",
      {
        partitionKey: {
          name: "product_code",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: { name: "params_hash", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.AWS_MANAGED,
        timeToLiveAttribute: "ttl",
      }
    );

    const recipeCacheTable = new dynamodb.Table(
      this,
      "RecipeCacheTable",
      {
        partitionKey: {
          name: "ingredients_hash",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: { name: "params_hash", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.AWS_MANAGED,
        timeToLiveAttribute: "ttl",
      }
    );

    const ingredientCacheTable = new dynamodb.Table(
      this,
      "IngredientCacheTable",
      {
        partitionKey: {
          name: "image_hash",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.AWS_MANAGED,
        timeToLiveAttribute: "ttl",
      }
    );

    const myResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "ResponseHeadersPolicy",
      {
        responseHeadersPolicyName:
          "ResponseHeadersPolicy" + Aws.STACK_NAME + "-" + Aws.REGION,
        comment: "ResponseHeadersPolicy" + Aws.STACK_NAME + "-" + Aws.REGION,
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: false,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.seconds(31536000),
            includeSubdomains: true,
            override: true,
          },
          xssProtection: { protection: true, modeBlock: true, override: true },
        },
      }
    );

    // Optimized cache policy for static assets
    const staticAssetCachePolicy = new cloudfront.CachePolicy(
      this,
      "StaticAssetCachePolicy",
      {
        cachePolicyName: "StaticAssetCache-" + Aws.STACK_NAME,
        defaultTtl: Duration.hours(24),
        minTtl: Duration.minutes(1),
        maxTtl: Duration.days(365),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      }
    );

    // S3 access logging bucket
    const accessLogsBucket = new s3.Bucket(this, "AccessLogsBucket", {
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });

    const hostingBucket = new s3.Bucket(this, "HostingBucket", {
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicPolicy: true,
        blockPublicAcls: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      }),
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "hosting-logs/",
    });

    const imgBucket = new s3.Bucket(this, "ImgBucket", {
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicPolicy: true,
        blockPublicAcls: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      }),
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "img-logs/",
    });

    const hostingOrigin = origins.S3BucketOrigin.withOriginAccessControl(hostingBucket);
    const s3ImgOrigin = origins.S3BucketOrigin.withOriginAccessControl(imgBucket);

    const customImgBehaviour: cloudfront.BehaviorOptions = {
      origin: s3ImgOrigin,
      responseHeadersPolicy: myResponseHeadersPolicy,
      cachePolicy: staticAssetCachePolicy,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    const changeUri = new cloudfront.Function(this, "ChangeUri", {
      code: cloudfront.FunctionCode.fromFile({
        filePath: "lambda/url_rewrite/index.js",
      }),
      comment: "URL Rewrite function",
    });

    // WAF WebACL for CloudFront (AwsSolutions-CFR2)
    const webAcl = new wafv2.CfnWebACL(this, "CloudFrontWebACL", {
      defaultAction: { allow: {} },
      scope: "CLOUDFRONT",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "FoodAnalyzerWAF",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
              excludedRules: [
                { name: "SizeRestrictions_BODY" },
                { name: "CrossSiteScripting_BODY" },
                { name: "GenericRFI_BODY" },
              ],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "CommonRuleSet",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // CloudFront access logging bucket (AwsSolutions-CFR3)
    const cfLogsBucket = new s3.Bucket(this, "CloudFrontLogsBucket", {
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "cf-logs-bucket-logs/",
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });

    const distribution = new cloudfront.Distribution(this, "distribution", {
      comment: "FoodAnalyzer UI",
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: webAcl.attrArn,
      enableLogging: true,
      logBucket: cfLogsBucket,
      logFilePrefix: "cf-access-logs/",
      geoRestriction: cloudfront.GeoRestriction.allowlist(
        "US", "FR", "DE", "GB", "ES", "IT", "NL", "BE", "CH", "AT",
        "PT", "IE", "LU", "SE", "DK", "FI", "NO", "PL", "CZ", "JP",
        "AU", "CA", "SG", "IN", "BR", "MX", "KR", "IL"
      ),
      defaultBehavior: {
        origin: hostingOrigin,
        responseHeadersPolicy: myResponseHeadersPolicy,
        cachePolicy: staticAssetCachePolicy,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: changeUri,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/img/*": customImgBehaviour,
      },
    });

    const auth = new Auth(this, "Authentication");

    new CfnOutput(this, "domainName", {
      value: distribution.distributionDomainName,
    });

    const lambdaRole = new iam.Role(this, "LambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    const basicLambdaRole = new iam.Role(this, "BasicLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    const barcodeIngredientsLogGroup = new logs.LogGroup(this, "GetIngredientsLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logEncryptionKey,
    });
    const barcodeIngredientsFunction = new lambda.Function(
      this,
      "GetIngredients",
      {
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/barcode_ingredients", {
          bundling: {
            image: lambda.Runtime.PYTHON_3_12.bundlingImage,
            command: [
              "bash", "-c",
              "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output"
            ],
            local: {
              tryBundle(outputDir: string) {
                try {
                  execSync(
                    `pip3 install -r requirements.txt -t "${outputDir}" --quiet`,
                    { cwd: path.join(__dirname, "../lambda/barcode_ingredients"), stdio: "inherit" }
                  );
                  Utils.copyDirRecursive(
                    path.join(__dirname, "../lambda/barcode_ingredients"),
                    outputDir
                  );
                  return true;
                } catch {
                  return false;
                }
              },
            },
          },
        }),
        memorySize: 10240,
        role: lambdaRole,
        layers: [powerToolsLayer],
        tracing: Tracing.ACTIVE,
        timeout: Duration.minutes(5),
        logGroup: barcodeIngredientsLogGroup,
        retryAttempts: 0,
        environment: {
          POWERTOOLS_SERVICE_NAME: "food-lens",
          POWERTOOLS_LOG_LEVEL: "DEBUG",
          API_URL: "https://world.openfoodfacts.org",
          LANGUAGE: "French",
          PRODUCT_TABLE_NAME: productsTable.tableName,
          OPEN_FOOD_FACTS_TABLE_NAME: openFoodFactsProductsTable.tableName,
        },
      }
    );


    this.getIngredients = barcodeIngredientsFunction;

    productsTable.grantReadWriteData(barcodeIngredientsFunction);
    openFoodFactsProductsTable.grantReadData(barcodeIngredientsFunction)

    barcodeIngredientsFunction.metricInvocations();
    barcodeIngredientsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`],
      })
    );

    barcodeIngredientsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    const ingredientsFunctionUrl = barcodeIngredientsFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    const recipeImageIngredientsLogGroup = new logs.LogGroup(this, "GetImageIngredientsLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logEncryptionKey,
    });
    const recipeImageIngredientsFunction = new lambda.Function(
      this,
      "GetImageIngredients",
      {
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/recipe_image_ingredients"),
        memorySize: 10240,
        role: lambdaRole,
        layers: [powerToolsLayer],
        tracing: Tracing.ACTIVE,
        timeout: Duration.minutes(5),
        logGroup: recipeImageIngredientsLogGroup,
        retryAttempts: 0,
        environment: {
          POWERTOOLS_SERVICE_NAME: "food-lens",
          POWERTOOLS_LOG_LEVEL: "DEBUG",
          INGREDIENT_CACHE_TABLE_NAME: ingredientCacheTable.tableName,
        },
      }
    );

    this.getImageIngredients = recipeImageIngredientsFunction;

    ingredientCacheTable.grantReadWriteData(recipeImageIngredientsFunction);

    recipeImageIngredientsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`],
      })
    );

    recipeImageIngredientsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    const recipeProposalsLogGroup = new logs.LogGroup(this, "GenerateRecipeLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logEncryptionKey,
    });
    const recipeProposalsFunction = new lambda.Function(
      this,
      "GenerateRecipe",
      {
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: "index.handler",
        code: lambda.Code.fromAsset("lambda/recipe_proposals"),
        memorySize: 10240,
        role: lambdaRole,
        layers: [powerToolsLayer],
        tracing: Tracing.ACTIVE,
        timeout: Duration.minutes(5),
        logGroup: recipeProposalsLogGroup,
        retryAttempts: 0,
        environment: {
          POWERTOOLS_SERVICE_NAME: "food-lens",
          POWERTOOLS_LOG_LEVEL: "DEBUG",
          S3_BUCKET_NAME: imgBucket.bucketName,
          RECIPE_CACHE_TABLE_NAME: recipeCacheTable.tableName,
        },
      }
    );
    this.generateRecipe = recipeProposalsFunction;

    imgBucket.grantWrite(recipeProposalsFunction);
    recipeCacheTable.grantReadWriteData(recipeProposalsFunction);

    recipeProposalsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`],
      })
    );

    recipeProposalsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}::foundation-model/amazon.nova-canvas-v1:0`,
        ],
      })
    );

    const barcodeImageLogGroup = new logs.LogGroup(this, "GenerateImageLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logEncryptionKey,
    });
    const barcodeImageFunction = new lambda.Function(this, "GenerateImage", {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/barcode_image"),
      memorySize: 10240,
      timeout: Duration.minutes(5),
      role: basicLambdaRole,
      layers: [powerToolsLayer],
      logGroup: barcodeImageLogGroup,
      environment: {
        POWERTOOLS_SERVICE_NAME: "food-lens",
        POWERTOOLS_LOG_LEVEL: "DEBUG",
        S3_BUCKET_NAME: imgBucket.bucketName,
        PRODUCT_SUMMARY_TABLE_NAME: productsSummaryTable.tableName,
        PRODUCT_TABLE_NAME: productsTable.tableName,
      },
    });

    this.generateImage = barcodeImageFunction;

    imgBucket.grantWrite(barcodeImageFunction);

    barcodeImageFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`],
      })
    );

    const barcodeProductSummaryLogGroup = new logs.LogGroup(this, "GetProductSummaryLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logEncryptionKey,
    });
    const barcodeProductSummaryFunction = new nodejs.NodejsFunction(
      this,
      "GetProductSummaryLambda",
      {
        entry: path.join(
          __dirname,
          "../lambda/barcode_product_summary/index.ts"
        ),
        runtime: lambda.Runtime.NODEJS_24_X,
        role: basicLambdaRole,
        timeout: Duration.minutes(10),
        layers: [powerToolsTypeScriptLayer],
        logGroup: barcodeProductSummaryLogGroup,
        environment: {
          POWERTOOLS_SERVICE_NAME: "food-lens",
          POWERTOOLS_LOG_LEVEL: "DEBUG",
          PRODUCT_TABLE_NAME: productsTable.tableName,
          PRODUCT_SUMMARY_TABLE_NAME: productsSummaryTable.tableName,
        },
        bundling: {
          minify: false,
          externalModules: ["@aws-sdk/client-bedrock-runtime", "aws-lambda"],
        },
      }
    );

    this.productSummary = barcodeProductSummaryFunction;

    const recipeStepByStepLogGroup = new logs.LogGroup(this, "RecipeStepByStepLogGroup", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logEncryptionKey,
    });
    const recipeStepByStepFunction = new nodejs.NodejsFunction(
      this,
      "recipeStepByStepFunction",
      {
        entry: path.join(__dirname, "../lambda/recipe_step_by_step/index.ts"),
        runtime: lambda.Runtime.NODEJS_24_X,
        role: basicLambdaRole,
        timeout: Duration.minutes(10),
        layers: [powerToolsTypeScriptLayer],
        logGroup: recipeStepByStepLogGroup,
        environment: {
          POWERTOOLS_SERVICE_NAME: "food-lens",
          POWERTOOLS_LOG_LEVEL: "DEBUG",
        },
        bundling: {
          minify: false,
          externalModules: ["@aws-sdk/client-bedrock-runtime", "aws-lambda"],
        },
      }
    );

    this.getStepsRecipe = recipeStepByStepFunction;

    recipeStepByStepFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`],
      })
    );

    recipeStepByStepFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    productsTable.grantReadData(barcodeProductSummaryFunction);
    productsSummaryTable.grantReadWriteData(barcodeProductSummaryFunction);

    barcodeProductSummaryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`],
      })
    );

    barcodeProductSummaryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}::foundation-model/amazon.nova-canvas-v1:0`,
        ],
      })
    );

    const barcodeProductSummaryFunctionUrl =
      barcodeProductSummaryFunction.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM,
        invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      });

    const barcodeImageFunctionUrl = barcodeImageFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    const recipeImageIngredientsFunctionUrl =
      recipeImageIngredientsFunction.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM,
      });

    const recipeProposalsFunctionUrl = recipeProposalsFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    const getStepsRecipeeFunctionUrl = recipeStepByStepFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    const authFunction = new cloudfront.experimental.EdgeFunction(
      this,
      `AuthFunctionAtEdge`,
      {
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/auth")),
      }
    );

    authFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "AllowInvokeFunctionUrl",
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunctionUrl"],
        resources: [
          ingredientsFunctionUrl.functionArn,
          recipeImageIngredientsFunctionUrl.functionArn,
          barcodeProductSummaryFunctionUrl.functionArn,
          barcodeImageFunctionUrl.functionArn,
          recipeImageIngredientsFunctionUrl.functionArn,
          recipeProposalsFunctionUrl.functionArn,
          getStepsRecipeeFunctionUrl.functionArn,
        ],
        conditions: {
          StringEquals: { "lambda:FunctionUrlAuthType": "AWS_IAM" },
        },
      })
    );

    authFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${Stack.of(this).region}:${
            Stack.of(this).account
          }:secret:FoodAnalyzerSecret*`,
        ],
      })
    );

    const cachePolicy = new cloudfront.CachePolicy(
      this,
      "CachingDisabledButWithAuth",
      {
        defaultTtl: Duration.minutes(0),
        minTtl: Duration.minutes(0),
        maxTtl: Duration.minutes(1),
        headerBehavior:
          cloudfront.CacheHeaderBehavior.allowList("Authorization"),
      }
    );

    const commonBehaviorOptions: AddBehaviorOptions = {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: cachePolicy,
      originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_CUSTOM_ORIGIN,
      responseHeadersPolicy:
        cloudfront.ResponseHeadersPolicy
          .CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
    };

    const getBehaviorOptions: AddBehaviorOptions = {
      ...commonBehaviorOptions,
      edgeLambdas: [
        {
          functionVersion: authFunction.currentVersion,
          eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          includeBody: true,
        },
      ],
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    };

    distribution.addBehavior(
      "/fetchIngredients/*",
      new HttpOrigin(Fn.select(2, Fn.split("/", ingredientsFunctionUrl.url))),
      getBehaviorOptions
    );

    distribution.addBehavior(
      "/fetchSummary",
      new HttpOrigin(
        Fn.select(2, Fn.split("/", barcodeProductSummaryFunctionUrl.url))
      ),
      getBehaviorOptions
    );

    distribution.addBehavior(
      "/fetchImage",
      new HttpOrigin(Fn.select(2, Fn.split("/", barcodeImageFunctionUrl.url))),
      getBehaviorOptions
    );

    distribution.addBehavior(
      "/fetchImageIngredients",
      new HttpOrigin(
        Fn.select(2, Fn.split("/", recipeImageIngredientsFunctionUrl.url))
      ),
      getBehaviorOptions
    );

    distribution.addBehavior(
      "/fetchRecipePropositions",
      new HttpOrigin(
        Fn.select(2, Fn.split("/", recipeProposalsFunctionUrl.url))
      ),
      getBehaviorOptions
    );

    distribution.addBehavior(
      "/stepsRecipe",
      new HttpOrigin(
        Fn.select(2, Fn.split("/", getStepsRecipeeFunctionUrl.url))
      ),

      getBehaviorOptions
    );

    const secret = new secretsmanager.Secret(this, "FoodAnalyserSecrets", {
      secretName: "FoodAnalyzerSecretConfig",
      secretObjectValue: {
        ClientID: SecretValue.unsafePlainText(
          auth.userPoolClient.userPoolClientId
        ),
        UserPoolID: SecretValue.unsafePlainText(auth.userPool.userPoolId),
      },
    });

    const exportsAsset = s3deploy.Source.jsonData("aws-exports.json", {
      domainName: "https://" + distribution.domainName,
      region: cdk.Aws.REGION,
      Auth: {
        Cognito: {
          userPoolClientId: auth.userPoolClient.userPoolClientId,
          userPoolId: auth.userPool.userPoolId,
          identityPoolId: auth.identityPool.identityPoolId,
        },
      },
    });

    const appPath = path.join(__dirname, "..", "resources", "ui");
    const buildPath = path.join(appPath, "dist");

    const asset = s3deploy.Source.asset(appPath, {
      bundling: {
        image: DockerImage.fromRegistry(
          "public.ecr.aws/sam/build-nodejs20.x:latest"
        ),
        command: [
          "sh",
          "-c",
          [
            "npm --cache /tmp/.npm install",
            `npm --cache /tmp/.npm run build`,
            "cp -aur /asset-input/dist/* /asset-output/",
          ].join(" && "),
        ],
        local: {
          tryBundle(outputDir: string) {
            try {
              const options: ExecSyncOptionsWithBufferEncoding = {
                stdio: "inherit",
                env: {
                  ...process.env,
                },
              };

              execSync(`npm --silent --prefix "${appPath}" ci`, options);
              execSync(`npm --silent --prefix "${appPath}" run build`, options);
              Utils.copyDirRecursive(buildPath, outputDir);
            } catch (e) {
              console.error(e);
              return false;
            }
            return true;
          },
        },
      },
    });

    new s3deploy.BucketDeployment(this, "DeployWebsite", {
      sources: [asset, exportsAsset],
      destinationBucket: hostingBucket,
      memoryLimit: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
    });
    
    // Deploy test fridge images to img bucket
    new s3deploy.BucketDeployment(this, "DeployTestImages", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "img"))],
      destinationBucket: imgBucket,
      destinationKeyPrefix: "img/",
      memoryLimit: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
    });

    // Override BucketDeployment singleton Lambda memory/storage via escape hatch
    this.node.findAll().forEach(child => {
      if (child.node.id.includes('CDKBucketDeployment') && (child as any).functionArn) {
        const cfnFn = (child as any).node.defaultChild;
        if (cfnFn && cfnFn.memorySize !== undefined) {
          cfnFn.addPropertyOverride('MemorySize', 1024);
          cfnFn.addPropertyOverride('EphemeralStorage', { Size: 1024 });
        }
      }
    });
    
    // BucketDeployment Lambda memory override handled via cdk.json context

    new FoodAnalyzerDashBoard(this, "Dashboard", {
      stage: stage,
      functionList: [
        this.generateImage,
        this.getImageIngredients,
        this.getIngredients,
        this.getStepsRecipe,
        this.productSummary,
        this.generateRecipe,
      ],
    });



  const loadDatabase = new LoadDatabase(this, "LoadSF", openFoodFactsProductsTable, this.stackName, accessLogsBucket);

    // Enable CloudTrail for audit logging
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "trail-bucket-logs/",
      lifecycleRules: [{
        expiration: Duration.days(90),
      }],
    });

    const trail = new cloudtrail.Trail(this, 'AuditTrail', {
      trailName: `FoodAnalyzer-${stage}-Trail`,
      bucket: trailBucket,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    // cdk-nag suppressions — only for CDK construct limitations that cannot be fixed in code
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'AWS managed AWSLambdaBasicExecutionRole used by CDK-managed constructs (BucketDeployment, LogRetention, EdgeFunction) whose roles are not directly controllable' },
      { id: 'AwsSolutions-CFR4', reason: 'Default CloudFront certificate (*.cloudfront.net) enforces TLSv1 minimum regardless of minimumProtocolVersion — requires custom domain + ACM cert to fix' },
      { id: 'AwsSolutions-SMG4', reason: 'Secret contains Cognito UserPool/Client IDs (configuration data), not credentials — rotation is not applicable' },
      { id: 'AwsSolutions-L1', reason: 'CDK BucketDeployment internal Lambda runtime is managed by the CDK construct and cannot be overridden' },
    ]);

    // Scoped suppressions for CDK-generated wildcard policies we cannot control
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions auto-generated by CDK BucketDeployment and LogRetention constructs — not directly controllable',
        appliesTo: [
          'Action::s3:GetBucket*', 'Action::s3:GetObject*', 'Action::s3:List*', 'Action::s3:Abort*', 'Action::s3:DeleteObject*',
          'Resource::*',
          'Resource::<HostingBucket5DAC2127.Arn>/*',
          'Resource::<ImgBucketDC4B6F5E.Arn>/*',
          'Resource::<LoadSFLoadSourceCode8FD66298.Arn>/*',
        ],
      },
      { id: 'AwsSolutions-IAM5', reason: 'CDK BucketDeployment needs access to CDK assets bucket — not controllable',
        appliesTo: [`Resource::arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`],
      },
    ]);

    // Suppressions for CDK grant()-generated S3 wildcards and Cognito SMS role
    NagSuppressions.addResourceSuppressionsByPath(this,
      '/FoodAnalyzer/Authentication/FoodAnalyzerUserPool/smsRole/Resource',
      [{ id: 'AwsSolutions-IAM5', reason: 'Cognito SMS role with Resource::* is auto-generated by CDK UserPool construct for SNS SMS publishing' }],
    );
    for (const rolePath of ['/FoodAnalyzer/LambdaRole/DefaultPolicy/Resource', '/FoodAnalyzer/BasicLambdaRole/DefaultPolicy/Resource']) {
      NagSuppressions.addResourceSuppressionsByPath(this, rolePath, [
        { id: 'AwsSolutions-IAM5', reason: 'S3 grantWrite() generates s3:Abort*, s3:DeleteObject*, bucket/* — CDK grant pattern, bucket-scoped', appliesTo: ['Action::s3:Abort*', 'Action::s3:DeleteObject*', 'Resource::<ImgBucketDC4B6F5E.Arn>/*'] },
        { id: 'AwsSolutions-IAM5', reason: 'Log group name is dynamic (CDK-generated), wildcard after /aws/lambda/ prefix is necessary', appliesTo: ['Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/lambda/*'] },
        { id: 'AwsSolutions-IAM5', reason: 'DynamoDB grantReadWriteData() generates index wildcard — CDK grant pattern', appliesTo: ['Resource::*'] },
        { id: 'AwsSolutions-IAM5', reason: 'Cross-region inference profile requires foundation model ARN with wildcard region', appliesTo: ['Resource::arn:<AWS::Partition>:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0'] },
      ]);
    }

    // LoadSF and AuthEdge construct suppressions
    NagSuppressions.addResourceSuppressionsByPath(this, [
      '/FoodAnalyzer/LoadSF/Project/Role/DefaultPolicy/Resource',
      '/FoodAnalyzer/LoadSF/LoadDatabase/Role/DefaultPolicy/Resource',
    ], [
      { id: 'AwsSolutions-IAM5', reason: 'CodeBuild and StepFunctions roles require wildcards for log groups, report groups, and S3 source — CDK construct generated' },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(this,
      '/FoodAnalyzer/AuthFunctionAtEdge/Fn/ServiceRole/DefaultPolicy/Resource',
      [{ id: 'AwsSolutions-IAM5', reason: 'Secrets Manager ARN uses wildcard suffix because CDK appends random chars to secret name' }],
    );
  }

  /**
   * Extracts the domain from a Lambda URL
   *
   * Example: https://my-lambda.execute-api.us-east-1.amazonaws.com/ -> my-lambda.execute-api.us-east-1.amazonaws.com
   */
  getURLDomain(lambdaUrl: lambda.FunctionUrl) {
    return Fn.select(2, Fn.split("/", lambdaUrl.url));
  }


}
