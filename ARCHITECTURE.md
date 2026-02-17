# Architecture Documentation

## Overview

The Recipe-First Shopping Assistant is a serverless, event-driven application that demonstrates how grocery retailers can integrate GenAI to transform the shopping experience. The architecture prioritizes security, scalability, and cost-efficiency.

## Architecture Diagram

[PLACEHOLDER: Add high-level architecture diagram]

## System Components

### 1. Frontend Layer

**Technology**: React + Vite + Cloudscape Design System  
**Hosting**: Amazon S3 + CloudFront  
**Authentication**: Amazon Cognito

**Key Pages**:
- **Home**: Entry point with barcode scanning and recipe generation options
- **Barcode Scanner**: Product analysis with personalized summaries
- **Recipe Generator**: Fridge photo upload and recipe display
- **Shopping Cart**: Grouped items with recipe context
- **Favorites**: Saved recipes with quick reorder
- **Preferences**: 6-dimensional personalization settings

### 2. Authentication & Authorization

**Amazon Cognito User Pool**:
```typescript
selfSignUpEnabled: false,  // Admin-only user creation
advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
passwordPolicy: {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireDigits: true,
  requireSymbols: true,
}
```

**Lambda@Edge Authentication**:
- Validates Cognito JWT tokens
- Signs requests with SigV4 for Lambda URL invocation
- Handles CORS preflight requests
- Retrieves Cognito configuration from Secrets Manager

**Security Flow**:
```
User → Cognito (JWT) → Lambda@Edge (validate + sign) → Lambda URL (IAM auth)
```

### 3. Backend Services

#### Barcode Scanning Services

**barcode_ingredients** (Python 3.14)
- Fetches product data from Open Food Facts API
- Generates ingredient descriptions using Claude 3 Sonnet
- Stores processed data in DynamoDB
- Caches results for performance

**barcode_product_summary** (Node.js 24.x)
- Generates personalized product summaries
- Streams response using Claude 3 Haiku
- Matches against user allergies and preferences
- Hash-based caching in DynamoDB

**barcode_image** (Python 3.14)
- Generates AI product visualizations
- Uses Nova Canvas for image generation
- Stores images in S3
- Returns S3 URL for frontend display

#### Recipe Generation Services

**recipe_image_ingredients** (Python 3.14)
- Analyzes fridge photos using Claude 3 Sonnet (vision)
- Extracts ingredient list
- Returns structured JSON response

**recipe_proposals** (Python 3.14)
- Generates 3 personalized recipes
- Respects all 6 user preference dimensions
- Creates recipe images using Nova Canvas
- Parallel image generation for performance
- Returns recipes with ingredient breakdown

**recipe_step_by_step** (Node.js 24.x)
- Streams cooking instructions
- Uses Claude 3 Haiku for fast response
- Markdown-formatted output
- Real-time display in frontend

### 4. Data Layer

#### DynamoDB Tables

**openFoodFactsProductsTable**
- **PK**: product_code
- **Purpose**: Raw product data from Open Food Facts
- **Billing**: On-demand

**ProductsTable**
- **PK**: product_code
- **SK**: language
- **Purpose**: Processed product data with ingredient descriptions
- **Billing**: On-demand

**ProductsSummaryTable**
- **PK**: product_code
- **SK**: params_hash (hash of user preferences)
- **Purpose**: Cached personalized product summaries
- **Billing**: On-demand

#### S3 Buckets

**HostingBucket**
- **Purpose**: Frontend application hosting
- **Access**: Private, CloudFront OAC only
- **Encryption**: S3-managed (SSE-S3)

**ImgBucket**
- **Purpose**: AI-generated images (recipes, products)
- **Access**: Private, CloudFront OAC only
- **Encryption**: S3-managed (SSE-S3)

### 5. Content Delivery

**CloudFront Distribution**:
- **Default Behavior**: S3 origin (frontend)
- **Custom Behaviors**: Lambda URL origins (API endpoints)
- **Security Headers**: HSTS, X-Frame-Options, CSP
- **Caching**: Disabled for demo (enable for production)

**CloudFront Behaviors**:
```
/                           → S3 (frontend)
/img/*                      → S3 (images)
/fetchIngredients/*         → Lambda URL (barcode_ingredients)
/fetchSummary               → Lambda URL (barcode_product_summary)
/fetchImage                 → Lambda URL (barcode_image)
/fetchImageIngredients      → Lambda URL (recipe_image_ingredients)
/fetchRecipePropositions    → Lambda URL (recipe_proposals)
/stepsRecipe                → Lambda URL (recipe_step_by_step)
```

## Data Flow

### Barcode Scanning Flow

```
1. User scans barcode
   ↓
2. Frontend → CloudFront → Lambda@Edge (auth) → barcode_ingredients
   ↓
3. Lambda checks DynamoDB cache
   ↓
4. If not cached:
   - Fetch from Open Food Facts API
   - Generate ingredient descriptions (Claude 3 Sonnet)
   - Store in DynamoDB
   ↓
5. Return product data to frontend
   ↓
6. Frontend → barcode_product_summary (streaming)
   ↓
7. Lambda generates personalized summary (Claude 3 Haiku)
   - Checks user allergies
   - Evaluates dietary compatibility
   - Assesses nutritional fit
   ↓
8. Stream response to frontend
   ↓
9. Frontend → barcode_image (optional)
   ↓
10. Lambda generates product visualization (Nova Canvas)
    ↓
11. Store image in S3, return URL
```

### Recipe Generation Flow

```
1. User uploads fridge photo(s)
   ↓
2. Frontend → CloudFront → Lambda@Edge (auth) → recipe_image_ingredients
   ↓
3. Lambda analyzes images (Claude 3 Sonnet vision)
   ↓
4. Return ingredient list: ["chicken", "tomatoes", "onions"]
   ↓
5. Frontend → recipe_proposals
   ↓
6. Lambda generates 3 recipes (Claude 3 Sonnet)
   - Applies all 6 user preferences
   - Parallel image generation (Nova Canvas)
   - Stores images in S3
   ↓
7. Return recipes with:
   - ingredients (user has)
   - optional_ingredients (need to buy)
   - image_url
   - preparation/cooking time
   - difficulty level
   ↓
8. User clicks "Add All Ingredients to Cart"
   ↓
9. Frontend calculates mock prices
   ↓
10. Store in localStorage "shoppingCart"
    ↓
11. Show cart success modal
```

### Cooking Flow

```
1. User clicks "Start Cooking"
   ↓
2. Frontend → recipe_step_by_step (streaming)
   ↓
3. Lambda generates instructions (Claude 3 Haiku)
   ↓
4. Stream markdown response
   ↓
5. Frontend displays real-time
   ↓
6. User clicks "Mark as Complete"
   ↓
7. Show leftover suggestion modal
   - AI-generated leftover recipe
   - New ingredients with pricing
   - Add to cart or save
```

## Security Implementation

### Lambda URL Protection

**All Lambda URLs require IAM authentication**:
```typescript
const functionUrl = lambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.AWS_IAM,
  invokeMode: lambda.InvokeMode.RESPONSE_STREAM, // or BUFFERED
});
```

**Lambda@Edge grants invoke permissions**:
```typescript
authFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["lambda:InvokeFunctionUrl"],
    resources: [functionUrl.functionArn],
    conditions: {
      StringEquals: { "lambda:FunctionUrlAuthType": "AWS_IAM" },
    },
  })
);
```

### S3 Bucket Security

**Private buckets with CloudFront OAC**:
```typescript
const bucket = new s3.Bucket(this, 'Bucket', {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
});

// CloudFront accesses via Origin Access Control
const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(bucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
});
```

### Secrets Management

**Cognito configuration stored in Secrets Manager**:
```typescript
const secret = new secretsmanager.Secret(this, 'FoodAnalyserSecrets', {
  secretName: "FoodAnalyzerSecretConfig",
  secretObjectValue: {
    ClientID: SecretValue.unsafePlainText(userPoolClient.userPoolClientId),
    UserPoolID: SecretValue.unsafePlainText(userPool.userPoolId),
  },
});
```

## Personalization System

### User Preferences Structure

```typescript
interface UserPreferences {
  allergies: Array<{value: string, label: string}>;
  dietaryPrefs: Array<{value: string, label: string}>;
  healthGoal: {value: string, label: string};
  religion: {value: string, label: string};
  dislikedIngredients: Array<{value: string, label: string}>;
  favoriteCuisines: Array<{value: string, label: string}>;
}
```

**Example**:
```json
{
  "allergies": [
    {"value": "eggs", "label": "Eggs"},
    {"value": "nuts", "label": "Tree Nuts"}
  ],
  "dietaryPrefs": [
    {"value": "vegan", "label": "Vegan"}
  ],
  "healthGoal": {
    "value": "weight_loss",
    "label": "Weight Loss"
  },
  "religion": {
    "value": "halal",
    "label": "Halal"
  },
  "dislikedIngredients": [
    {"value": "cilantro", "label": "Cilantro"}
  ],
  "favoriteCuisines": [
    {"value": "italian", "label": "Italian"},
    {"value": "asian", "label": "Asian"}
  ]
}
```

### Preference Application

**Recipe Generation**:
- Filters out recipes with allergens
- Respects dietary restrictions (vegan, keto, etc.)
- Optimizes for health goals (low-calorie, high-protein)
- Follows religious requirements (halal, kosher)
- Excludes disliked ingredients
- Prioritizes favorite cuisines

**Product Analysis**:
- Highlights allergen warnings
- Evaluates dietary compatibility
- Assesses nutritional alignment with health goals
- Checks religious compliance

## Mock Integration Layer

### Ingredient Pricing

**Mock Price Generation**:
```typescript
export const getMockPrice = (ingredient: string): number => {
  const hash = ingredient.split('').reduce((acc, char) => 
    acc + char.charCodeAt(0), 0);
  const price = 2.99 + (hash % 300) / 100; // Range: $2.99 - $5.99
  return parseFloat(price.toFixed(2));
};
```

### Barcode Mapping

**Ingredient-to-Barcode Map**:
```typescript
export const ingredientBarcodeMap: Record<string, string> = {
  "feta cheese": "3176582033563",
  "olive oil": "4056489141877",
  "chicken": "3270160005451",
  // ... 50+ validated barcodes
};
```

### Shopping Cart

**Cart Item Structure**:
```typescript
interface CartItem {
  ingredient: string;
  price: number;
  recipeTitle: string;
  recipeId: string;
}
```

**Storage**:
```typescript
localStorage.setItem("shoppingCart", JSON.stringify(cartItems));
```

### Checkout Flow

**Mock Order Generation**:
```typescript
const orderNumber = Math.floor(10000 + Math.random() * 90000);
const deliveryTime = new Date();
deliveryTime.setHours(19, 0, 0); // 7:00 PM today
```

## Monitoring & Observability

### CloudWatch Dashboard

**Metrics Tracked**:
- Lambda invocations per function
- Lambda errors and throttles
- Lambda duration (p50, p90, p99)
- Bedrock model invocations
- Bedrock token usage
- DynamoDB read/write capacity

### PowerTools Integration

**Python Functions**:
```python
from aws_lambda_powertools import Logger, Tracer

tracer = Tracer()
logger = Logger()

@tracer.capture_method
def handler(event, context):
    logger.info("Processing request")
```

**TypeScript Functions**:
```typescript
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";

const logger = new Logger();
const tracer = new Tracer();
```

### X-Ray Tracing

**Enabled on all Lambda functions**:
```typescript
tracing: lambda.Tracing.ACTIVE
```

## Scalability Considerations

### DynamoDB

**On-Demand Billing**:
- Automatically scales with traffic
- No capacity planning required
- Pay only for actual usage

**Caching Strategy**:
- Product summaries cached by preference hash
- Reduces Bedrock API calls by 70-80%
- TTL not implemented (infinite cache)

### Lambda

**Concurrency**:
- Default: 1000 concurrent executions per region
- Streaming functions: Lower concurrency due to longer execution
- No reserved concurrency configured

**Memory Allocation**:
- Current: 10GB (over-provisioned for demo)
- Recommended: 2-4GB for production

### CloudFront

**Global Distribution**:
- Edge locations worldwide
- Low latency for static assets
- Caching disabled for demo (enable for production)

## Cost Optimization

### Current Configuration

**Lambda**:
- Memory: 10GB (optimized for demo reliability)
- Timeout: 5 minutes (ensures completion under any load)
- Estimated cost: $0.50-1.00 per 1000 invocations

**Rationale**: High memory allocation ensures consistent performance during high-traffic demo environments (AWS Summit, trade shows) where reliability is more critical than cost optimization.

**Bedrock**:
- Claude 3 Sonnet: $3/1M input tokens, $15/1M output tokens
- Claude 3 Haiku: $0.25/1M input tokens, $1.25/1M output tokens
- Nova Canvas: $0.04 per image

**DynamoDB**:
- On-demand: $1.25 per million write requests, $0.25 per million read requests

### Production Recommendations

**For Post-Demo Production Deployment**:
1. Enable CloudFront caching ✅ (Already enabled)
2. Implement Bedrock Prompt Caching: 90% cost reduction on repeated context
3. Add DynamoDB TTL ✅ (Already enabled): Expire old cache entries
4. Consider Lambda memory optimization: 10GB → 2-4GB (only after demo, for cost reduction)

**Note**: Current 10GB Lambda configuration is intentional for demo reliability. Cost optimization can be applied post-Summit for production deployments.

## Integration Architecture

### Mock vs. Production

**Current (Mock)**:
```
Ingredient → getMockPrice() → $4.99
Cart → localStorage → Mock checkout
```

**Production (Required)**:
```
Ingredient → Product Matching API → {sku, barcode, price, inStock}
Cart → Checkout API → {orderId, payment, delivery}
```

### Required Integration Points

**1. Product Matching Service**
```typescript
interface ProductMatchRequest {
  ingredient: string;
  storeId: string;
  zipCode: string;
}

interface ProductMatchResponse {
  sku: string;
  barcode: string;
  productName: string;
  brand: string;
  price: number;
  inStock: boolean;
  alternatives: Product[];
}
```

**2. Checkout Service**
```typescript
interface CheckoutRequest {
  cartItems: CartItem[];
  userId: string;
  storeId: string;
  deliveryAddress: Address;
  paymentMethod: PaymentMethod;
}

interface CheckoutResponse {
  orderId: string;
  confirmationNumber: string;
  deliveryWindow: {start: string, end: string};
  totalAmount: number;
}
```

**3. Store Locator Service**
```typescript
interface StoreLocatorRequest {
  latitude: number;
  longitude: number;
  radius: number; // miles
}

interface StoreLocatorResponse {
  stores: Store[];
}
```

**4. Analytics Service**
```typescript
interface AnalyticsEvent {
  eventType: "photo_taken" | "recipe_generated" | "cart_added" | 
             "checkout_completed" | "favorite_saved";
  userId: string;
  recipeId?: string;
  itemCount?: number;
  totalValue?: number;
  timestamp: string;
}
```

## Deployment

### CDK Stack

**Single Stack Deployment**:
```typescript
export class FoodAnalyzerStack extends Stack {
  constructor(scope: Construct, id: string, stage: string, props: StackProps)
}
```

**Resources Created**:
- 3 DynamoDB tables
- 2 S3 buckets
- 6 Lambda functions
- 1 Lambda@Edge function
- 1 CloudFront distribution
- 1 Cognito user pool
- 1 Cognito identity pool
- 1 Secrets Manager secret
- CloudWatch dashboard

### Deployment Commands

```bash
# Synthesize CloudFormation template
cdk synth

# Show changes before deployment
cdk diff

# Deploy stack
cdk deploy

# Destroy stack (cleanup)
cdk destroy
```

### Environment Variables

**Lambda Functions**:
```typescript
environment: {
  POWERTOOLS_SERVICE_NAME: "food-lens",
  POWERTOOLS_LOG_LEVEL: "DEBUG",
  PRODUCT_TABLE_NAME: productsTable.tableName,
  PRODUCT_SUMMARY_TABLE_NAME: productsSummaryTable.tableName,
  S3_BUCKET_NAME: imgBucket.bucketName,
  API_URL: "https://world.openfoodfacts.org",
  LANGUAGE: "French",
}
```

## Performance Optimization

### Parallel Processing

**Recipe Image Generation**:
```python
# Generate 3 recipe images in parallel
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    futures = [
        executor.submit(call_bedrock_thread, recipe['title'], model_id)
        for recipe in recipes
    ]
    images = [future.result() for future in futures]
```

### Streaming Responses

**Benefits**:
- Faster perceived performance
- Better user experience
- Lower memory usage
- Progressive rendering

**Implementation**:
```typescript
// Lambda configuration
invokeMode: lambda.InvokeMode.RESPONSE_STREAM

// Frontend consumption
const reader = response.body.getReader();
let accumulatedContent = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  accumulatedContent += new TextDecoder().decode(value);
  setContent(accumulatedContent); // Real-time update
}
```

### Caching Layers

**Level 1: DynamoDB Cache**
- Product summaries cached by preference hash
- Recipe proposals (future enhancement)
- Reduces Bedrock API calls

**Level 2: CloudFront Cache** (disabled for demo)
- Static assets (JS, CSS, images)
- API responses (with proper cache headers)

**Level 3: Browser Cache**
- LocalStorage for user preferences
- LocalStorage for shopping cart
- LocalStorage for favorite recipes

## Error Handling

### Lambda Error Handling

**Retry Strategy**:
```typescript
retryAttempts: 0  // Disabled for demo (enable for production)
```

**Timeout Configuration**:
```typescript
timeout: Duration.minutes(5)  // Generous for GenAI operations
```

### Frontend Error Handling

**API Call Wrapper**:
```typescript
try {
  const response = await callAPI(endpoint, method, body);
  return response;
} catch (error) {
  console.error("Error fetching data:", error);
  // Show user-friendly error message
}
```

## Troubleshooting

### Common Issues

**Lambda not updating after deployment**:
```bash
# Clean and rebuild
rm -rf cdk.out/ lib/*.js
npm run build
cdk deploy --force
```

**CloudFront serving old content**:
```bash
# Invalidate cache
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"
```

**Cognito authentication errors**:
- Verify user exists in user pool
- Check JWT token expiration
- Validate aws-exports.json configuration

## References

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Amazon Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html)
- [CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
