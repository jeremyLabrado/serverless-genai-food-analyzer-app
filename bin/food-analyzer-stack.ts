#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoodAnalyzerStack} from '../lib/food-analyzer-stack';
import { CfnGuardValidator } from '@cdklabs/cdk-validator-cfnguard';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

const deploymentStage = process.env.STAGE || "dev"

const app = new cdk.App({
  policyValidationBeta1: [
    new CfnGuardValidator({
      //controlTowerRulesEnabled: false,      
      disabledRules: [
        'ct-cloudfront-pr-4',  /* Origin failover requires a second S3 origin — single-origin demo app */
        'ct-cloudfront-pr-6',  /* Custom SSL certificate requires a custom domain + ACM cert */
        'ct-cloudfront-pr-7',  /* Custom SSL certificate requires a custom domain */
        'ct-cloudfront-pr-9',  /* Custom SSL certificate requires a custom domain */
        'ct-lambda-pr-3',  /* Serverless demo app — no VPC deployed */
        'ct-s3-pr-10',  /* S3-managed encryption used; KMS adds cost with no benefit for public demo assets */
        'ct-s3-pr-9',  /* Object lock not applicable — hosting and image buckets, not compliance data */
        'ct-s3-pr-4',  /* S3 event notifications not needed — no downstream event consumers */
        'ct-s3-pr-2',  /* Access logs bucket cannot log to itself — all other buckets log to this bucket */
        'cloud_trail_encryption_enabled_check', /* No CloudTrail resource in stack */
        'cloud_trail_cloud_watch_logs_enabled_check', /* No CloudTrail resource in stack */
        'ct-cloudtrail-pr-1', /* No CloudTrail resource in stack */
        'ct-cloudtrail-pr-3', /* No CloudTrail resource in stack */
        'ct-cloudtrail-pr-4', /* No CloudTrail resource in stack */
        'kms_create_grant_aws_service_check', /* CDK-generated KMS grant for CodeBuild — not controllable */
        'ct-kms-pr-3', /* CDK-generated KMS grant for CodeBuild — not controllable */
      ]
    })
  ],
});

const foodAnalyzer = new FoodAnalyzerStack(app, `FoodAnalyzer`,  deploymentStage,
  {
  crossRegionReferences: true,
  description: 'FoodAnalyzer Stack (uksb-jvil23fpqp)',
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT
  }
});

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));


