"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const logger_1 = require("@aws-lambda-powertools/logger");
const crypto_1 = require("crypto");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const logger = new logger_1.Logger();
const dynamodb = new client_dynamodb_1.DynamoDBClient({});
const PRODUCT_TABLE_NAME = process.env.PRODUCT_TABLE_NAME;
const PRODUCT_SUMMARY_TABLE_NAME = process.env.PRODUCT_SUMMARY_TABLE_NAME;
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const bedrockRuntimeClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.REGION || 'us-east-1' });
function generateProductSummaryPrompt(userAllergies, userPreference, userHealthGoal, userReligion, productIngredients, productName, productAllergens, productNutriments, productLabels, productCategories, language, nova_group, nutriscore_grade, ecoscore_grade, brands) {
    // Format nutriments for display
    let nutrimentInfo = '';
    if (productNutriments && Object.keys(productNutriments).length > 0) {
        nutrimentInfo = '\n<nutrition_per_100g>\n';
        if (productNutriments['energy-kcal_100g'])
            nutrimentInfo += `Calories: ${productNutriments['energy-kcal_100g']} kcal\n`;
        if (productNutriments['carbohydrates_100g'])
            nutrimentInfo += `Carbohydrates: ${productNutriments['carbohydrates_100g']}g\n`;
        if (productNutriments['sugars_100g'])
            nutrimentInfo += `Sugars: ${productNutriments['sugars_100g']}g\n`;
        if (productNutriments['fat_100g'])
            nutrimentInfo += `Fat: ${productNutriments['fat_100g']}g\n`;
        if (productNutriments['saturated-fat_100g'])
            nutrimentInfo += `Saturated Fat: ${productNutriments['saturated-fat_100g']}g\n`;
        if (productNutriments['proteins_100g'])
            nutrimentInfo += `Protein: ${productNutriments['proteins_100g']}g\n`;
        if (productNutriments['fiber_100g'])
            nutrimentInfo += `Fiber: ${productNutriments['fiber_100g']}g\n`;
        if (productNutriments['salt_100g'])
            nutrimentInfo += `Salt: ${productNutriments['salt_100g']}g\n`;
        nutrimentInfo += '</nutrition_per_100g>\n';
    }
    // Format allergens - only if user has allergies
    let allergenInfo = '';
    if (userAllergies && productAllergens && productAllergens.length > 0) {
        allergenInfo = `\n<product_allergens>${productAllergens.join(', ')}</product_allergens>\n`;
    }
    // Format labels
    let labelInfo = '';
    if (productLabels && productLabels.length > 0) {
        labelInfo = `\n<product_labels>${productLabels.join(', ')}</product_labels>\n`;
    }
    // Format categories
    let categoryInfo = '';
    if (productCategories) {
        categoryInfo = `\n<product_categories>${productCategories}</product_categories>\n`;
    }
    // Format quality indicators (only if present and relevant)
    let qualityInfo = '';
    if (userHealthGoal && (nova_group === 4 || nutriscore_grade === 'd' || nutriscore_grade === 'e')) {
        qualityInfo = '\n<product_quality>\n';
        if (nova_group === 4)
            qualityInfo += 'Processing: Ultra-processed (NOVA 4)\n';
        if (nutriscore_grade === 'd' || nutriscore_grade === 'e') {
            qualityInfo += `Nutri-Score: ${nutriscore_grade.toUpperCase()} (lower nutritional quality)\n`;
        }
        qualityInfo += '</product_quality>\n';
    }
    // Build instructions based on what user has set
    let instructions = `You are a nutrition expert providing recommendations about a specific product.

    Your task:
    `;
    if (userAllergies) {
        instructions += `1. CRITICAL: Check if any product allergens match the user's allergies (${userAllergies}). If there is a match, prominently warn the user.\n`;
    }
    if (userPreference) {
        instructions += `${userAllergies ? '2' : '1'}. Check if product labels match dietary preferences (${userPreference}). Use labels for direct matching, or analyze categories and ingredients.\n`;
    }
    if (userHealthGoal) {
        instructions += `${(userAllergies ? 1 : 0) + (userPreference ? 1 : 0) + 1}. Use nutritional data to assess if the product aligns with the health goal: ${userHealthGoal}.\n`;
        if (nova_group === 4 || nutriscore_grade === 'd' || nutriscore_grade === 'e') {
            instructions += `   - Consider the product quality indicators when making recommendations.\n`;
        }
    }
    if (userReligion) {
        instructions += `${(userAllergies ? 1 : 0) + (userPreference ? 1 : 0) + (userHealthGoal ? 1 : 0) + 1}. Check if product labels match religious requirement: ${userReligion}.\n`;
    }
    instructions += `- Present three nutritional benefits and three nutritional disadvantages for the product based on actual nutritionalvalues.
    If the user's information is not provided or is empty, offer general nutritional advice based on the product's nutritional data.
    IMPORTANT: Only mention allergens, dietary preferences, health goals, or religious requirements if the user has specified them. Do not discuss aspects the user hasn't set.`;
    let userContext = '';
    // nosemgrep: html-in-template-string -- These are XML-like tags in an LLM prompt sent to Bedrock, not browser HTML
    if (userAllergies)
        userContext += `\n<user_allergies>${userAllergies}</user_allergies>`; // nosemgrep: html-in-template-string
    if (userHealthGoal)
        userContext += `\n<user_health_goal>${userHealthGoal}</user_health_goal>`; // nosemgrep: html-in-template-string
    if (userPreference)
        userContext += `\n<user_dietary_preferences>${userPreference}</user_dietary_preferences>`; // nosemgrep: html-in-template-string
    if (userReligion)
        userContext += `\n<user_religious_requirement>${userReligion}</user_religious_requirement>`;
    // nosemgrep: html-in-template-string -- LLM prompt template with XML-like tags, not rendered HTML
    return `Human:
          ${instructions}
  
          Provide recommendation for the following product:
            <product_name>${productName}</product_name>
            <product_ingredients>${productIngredients}</product_ingredients>
            <allergenInfo>${allergenInfo}</allergenInfo>
            <labelInfo>${labelInfo}</labelInfo>
            <categoryInfo>${categoryInfo}</categoryInfo>
            <nutrimentInfo>${nutrimentInfo}</nutrimentInfo>
            ${qualityInfo}

          For the user:
            ${userContext}
          
          Provide the response in the third person, in ${language}, skip the preambule, disregard any content at the end and provide only the response in this Markdown format:


        markdown

        Describe allergen warnings (if any), dietary label compatibility, religious requirement compatibility, health goal compatibility, dietary preference compatibility, and recommendation here combined in one single short paragraph

        #### Benefits title here
        - Describe benefits here

        #### Disadvantages title here
        - Describe disadvantages here
          
          Assistant:
          `;
}
function generateCombinedString(obj) {
    const concatenatedString = Object.keys(obj).join('');
    return concatenatedString;
}
function calculateHash(productCode, userAllergies, userPreferenceData, language) {
    /**
     * Calculates a SHA-256 hash based on various input data.
     *
     * @param userAllergies - A string containing user allergies data.
     * @param userPreferenceData - A string containing user preference data.
     * @param productIngredients - A string containing product ingredients data.
     * @param productName - The name of the product.
     * @param language - The language.
     * @param productAdditives - A string containing product additives data.
     * @returns The SHA-256 hash value calculated based on the concatenated string representations of the input data.
     */
    // Convert dictionaries to JSON strings
    const userAllergiesStr = generateCombinedString(userAllergies); //JSON.stringify(userAllergies);
    const userPreferenceDataStr = generateCombinedString(userPreferenceData);
    // Concatenate the string representations of the variables
    const concatenatedString = `${productCode}${userAllergiesStr}${userPreferenceDataStr}${language}`;
    // Calculate the hash
    const hashedValue = (0, crypto_1.createHash)('sha256').update(concatenatedString).digest('hex');
    return hashedValue;
}
/**
 * Retrieves product information from the database using the provided product code.
 *
 * @param productCode - The code of the product to retrieve information for.
 * @param language - The language for the product information.
 * @returns A tuple containing product name, ingredients, additives, allergens, nutriments, labels, categories, nova_group, nutriscore_grade, ecoscore_grade, and brands if the product is found in the database; otherwise, returns [null, null, null, null, null, null, null, null, null, null, null].
 */
async function getProductFromDb(productCode, language) {
    try {
        const { Item = {} } = await dynamodb.send(new client_dynamodb_1.GetItemCommand({
            TableName: PRODUCT_TABLE_NAME,
            Key: {
                product_code: { S: productCode },
                language: { S: language }
            }
        }));
        // Check if the item exists
        if (Item) {
            const item = (0, util_dynamodb_1.unmarshall)(Item);
            return [
                item.product_name || null,
                item.ingredients || null,
                item.additives || null,
                item.allergens_tags || null,
                item.nutriments || null,
                item.labels_tags || null,
                item.categories || null,
                item.nova_group || null,
                item.nutriscore_grade || null,
                item.ecoscore_grade || null,
                item.brands || null
            ];
        }
        else {
            return [null, null, null, null, null, null, null, null, null, null, null];
        }
    }
    catch (e) {
        console.error('Error while getting the Product from database', e);
        return [null, null, null, null, null, null, null, null, null, null, null];
    }
}
async function getProductSummary(productCode, paramsHash) {
    /**
     * Retrieves the summary of a product from the database using the product code and parameters hash.
     *
     * @param productCode - The code of the product.
     * @param paramsHash - The hash value representing parameters.
     * @returns The summary of the product if found in the database; otherwise, returns null.
     */
    const { Item = {} } = await dynamodb.send(new client_dynamodb_1.GetItemCommand({
        TableName: PRODUCT_SUMMARY_TABLE_NAME,
        Key: {
            product_code: { S: productCode },
            params_hash: { S: paramsHash }
        }
    }));
    if (Item) {
        const item = (0, util_dynamodb_1.unmarshall)(Item);
        return item.summary;
    }
    else {
        return null;
    }
}
async function generateSummary(promptText, responseStream) {
    const payload = {
        messages: [
            {
                role: "user",
                content: [
                    {
                        "type": "text",
                        "text": promptText
                    }
                ]
            }
        ],
        max_tokens: 500,
        temperature: 0.5,
        anthropic_version: "bedrock-2023-05-31"
    };
    const params = {
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
        performanceConfigLatency: 'standard'
    };
    let completion = '';
    try {
        try {
            const command = new client_bedrock_runtime_1.InvokeModelWithResponseStreamCommand(params);
            const response = await bedrockRuntimeClient.send(command);
            const events = response.body;
            for await (const event of events || []) {
                // Check the top-level field to determine which event this is.
                if (event.chunk) {
                    const decoded_event = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
                    if (decoded_event.type === 'content_block_delta' && decoded_event.delta.type === 'text_delta') {
                        responseStream.write(decoded_event.delta.text);
                        completion += decoded_event.delta.text;
                    }
                }
                else {
                    logger.error(`event = ${event}`);
                }
            }
            logger.info('Stream ended!');
        }
        catch (err) {
            // handle error
            logger.error(err);
        }
    }
    catch (e) {
        logger.error(`Error while generating summary: ${e}`);
        completion = "Error while generating summary";
    }
    return completion;
}
async function simulateSummaryStreaming(content, responseStream) {
    const chunks = [];
    let remainingContent = content;
    // Loop until all content is split into chunks
    while (remainingContent.length > 0) {
        // Generate a random chunk size between 1 and 10
        const chunkSize = Math.floor(Math.random() * 10) + 1;
        // Take a chunk of content with the generated chunk size
        const chunk = remainingContent.slice(0, chunkSize);
        // Add the chunk to the array
        chunks.push(chunk);
        // Remove the taken chunk from the remaining content
        remainingContent = remainingContent.slice(chunkSize);
    }
    // Simulate streaming by emitting each chunk with a delay
    for (const chunk of chunks) {
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate delay
        responseStream.write(chunk);
    }
}
async function putProductSummaryToDynamoDB(product_code, params_hash, summary) {
    try {
        await dynamodb.send(new client_dynamodb_1.PutItemCommand({
            TableName: PRODUCT_SUMMARY_TABLE_NAME,
            Item: {
                product_code: { S: product_code },
                params_hash: { S: params_hash },
                summary: { S: summary }
            }
        }));
        logger.debug("Summary saved into database");
    }
    catch (error) {
        console.error("Error:", error);
    }
}
async function messageHandler(event, responseStream) {
    try {
        logger.info(event);
        const body = event.body ? JSON.parse(event.body) : {};
        const productCode = body.productCode;
        const language = body.language;
        const userPreferenceKeys = Object.keys(body.preferences).filter(key => body.preferences[key]);
        const userAllergiesKeys = Object.keys(body.allergies).filter(key => body.allergies[key]);
        const userHealthGoal = body.healthGoal || '';
        const userReligion = body.religion || '';
        const userPreferenceString = userPreferenceKeys.join(', ');
        const userAllergiesString = userAllergiesKeys.join(', ');
        const [productName, productIngredients, productAdditives, productAllergens, productNutriments, productLabels, productCategories, nova_group, nutriscore_grade, ecoscore_grade, brands] = await getProductFromDb(productCode, language);
        if (productName && productIngredients) {
            logger.info("Product found");
        }
        else {
            logger.error("Product not found in the database");
            throw new Error('Product not found in the database');
        }
        const hashValue = calculateHash(productCode, userAllergiesString, userPreferenceString, language);
        let productSummary = await getProductSummary(productCode, hashValue);
        if (!productSummary) {
            logger.info("Product Summary not found in the database");
            const ingredientKeys = Object.keys(productIngredients);
            const ingredientsString = ingredientKeys.join(', ');
            const promptText = generateProductSummaryPrompt(userAllergiesString, userPreferenceString, userHealthGoal, userReligion, ingredientsString, productName, productAllergens || [], productNutriments || {}, productLabels || [], productCategories || '', language, nova_group || undefined, nutriscore_grade || undefined, ecoscore_grade || undefined, brands || undefined);
            productSummary = await generateSummary(promptText, responseStream);
            await putProductSummaryToDynamoDB(productCode, hashValue, productSummary);
        }
        else {
            await simulateSummaryStreaming(productSummary, responseStream);
        }
        logger.info(`Product Summary: ${productSummary}`);
    }
    catch (error) {
        console.error("Error:", error);
    }
    responseStream.end();
}
exports.handler = awslambda.streamifyResponse(messageHandler);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEY7QUFDMUYsMERBQW9EO0FBRXBELDBEQUF1RDtBQUV2RCxtQ0FBb0M7QUFDcEMsNEVBQTZHO0FBRTdHLE1BQU0sTUFBTSxHQUFHLElBQUksZUFBTSxFQUFFLENBQUM7QUFDNUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBRXhDLE1BQU0sa0JBQWtCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQTtBQUN6RCxNQUFNLDBCQUEwQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLENBQUE7QUFDekUsTUFBTSxRQUFRLEdBQUcsNkNBQTZDLENBQUE7QUFJOUQsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUE4Q3JHLFNBQVMsNEJBQTRCLENBQ2pDLGFBQXFCLEVBQ3JCLGNBQXNCLEVBQ3RCLGNBQXNCLEVBQ3RCLFlBQW9CLEVBQ3BCLGtCQUEwQixFQUMxQixXQUFtQixFQUNuQixnQkFBMEIsRUFDMUIsaUJBQXNCLEVBQ3RCLGFBQXVCLEVBQ3ZCLGlCQUF5QixFQUN6QixRQUFnQixFQUNoQixVQUFtQixFQUNuQixnQkFBeUIsRUFDekIsY0FBdUIsRUFDdkIsTUFBZTtJQUdmLGdDQUFnQztJQUNoQyxJQUFJLGFBQWEsR0FBRyxFQUFFLENBQUM7SUFDdkIsSUFBSSxpQkFBaUIsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtRQUNoRSxhQUFhLEdBQUcsMEJBQTBCLENBQUM7UUFDM0MsSUFBSSxpQkFBaUIsQ0FBQyxrQkFBa0IsQ0FBQztZQUFFLGFBQWEs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LFdBQVcsRUFDWCxnQkFBZ0IsSUFBSSxFQUFFLEVBQ3RCLGlCQUFpQixJQUFJLEVBQUUsRUFDdkIsYUFBYSxJQUFJLEVBQUUsRUFDbkIsaUJBQWlCLElBQUksRUFBRSxFQUN2QixRQUFTLEVBQ1QsVUFBVSxJQUFJLFNBQVMsRUFDdkIsZ0JBQWdCLElBQUksU0FBUyxFQUM3QixjQUFjLElBQUksU0FBUyxFQUMzQixNQUFNLElBQUksU0FBUyxDQUN0QixDQUFDO1lBQ0YsY0FBYyxHQUFHLE1BQU0sZUFBZSxDQUFDLFVBQVUsRUFBRSxjQUFjLENBQUMsQ0FBQztZQUNuRSxNQUFNLDJCQUEyQixDQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsY0FBYyxDQUFDLENBQUM7U0FDN0U7YUFDSTtZQUNELE1BQU0sd0JBQXdCLENBQUMsY0FBYyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1NBRWpFO1FBQ0QsTUFBTSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsY0FBYyxFQUFFLENBQUMsQ0FBQztLQUNyRDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ1osT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUM7S0FDbEM7SUFDRCxjQUFjLENBQUMsR0FBRyxFQUFFLENBQUM7QUFDekIsQ0FBQztBQUVZLFFBQUEsT0FBTyxHQUFHLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCwgUHV0SXRlbUNvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiXCI7XG5pbXBvcnQgeyB1bm1hcnNoYWxsIH0gZnJvbSBcIkBhd3Mtc2RrL3V0aWwtZHluYW1vZGJcIjtcbmltcG9ydCB7IFRyYWNlciB9IGZyb20gXCJAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlclwiO1xuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSBcIkBhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyXCI7XG5pbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudFYyLCBIYW5kbGVyLCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbUNvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZVwiO1xuXG5jb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG5jb25zdCBkeW5hbW9kYiA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XG5cbmNvbnN0IFBST0RVQ1RfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LlBST0RVQ1RfVEFCTEVfTkFNRVxuY29uc3QgUFJPRFVDVF9TVU1NQVJZX1RBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5QUk9EVUNUX1NVTU1BUllfVEFCTEVfTkFNRVxuY29uc3QgTU9ERUxfSUQgPSBcInVzLmFudGhyb3BpYy5jbGF1ZGUtaGFpa3UtNC01LTIwMjUxMDAxLXYxOjBcIlxuXG5cblxuY29uc3QgYmVkcm9ja1J1bnRpbWVDbGllbnQgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LlJFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuXG5kZWNsYXJlIGdsb2JhbCB7XG4gICAgbmFtZXNwYWNlIGF3c2xhbWJkYSB7XG4gICAgICBmdW5jdGlvbiBzdHJlYW1pZnlSZXNwb25zZShcbiAgICAgICAgZjogKFxuICAgICAgICAgIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudFYyLFxuICAgICAgICAgIHJlc3BvbnNlU3RyZWFtOiBOb2RlSlMuV3JpdGFibGVTdHJlYW0sXG4gICAgICAgICAgY29udGV4dDogQ29udGV4dFxuICAgICAgICApID0+IFByb21pc2U8dm9pZD5cbiAgICAgICk6IEhhbmRsZXI7XG4gICAgfVxufVxuXG5cblxuaW50ZXJmYWNlIFByb2R1Y3RJdGVtIHtcbiAgICBwcm9kdWN0X2NvZGU6IHN0cmluZztcbiAgICBsYW5ndWFnZTogc3RyaW5nO1xuICAgIHByb2R1Y3RfbmFtZT86IHN0cmluZztcbiAgICBpbmdyZWRpZW50cz86IHN0cmluZztcbiAgICBhZGRpdGl2ZXM/OiBzdHJpbmc7XG4gICAgYWxsZXJnZW5zX3RhZ3M/OiBzdHJpbmdbXTtcbiAgICBudXRyaW1lbnRzPzogYW55O1xuICAgIGxhYmVsc190YWdzPzogc3RyaW5nW107XG4gICAgY2F0ZWdvcmllcz86IHN0cmluZztcbiAgICBub3ZhX2dyb3VwPzogbnVtYmVyO1xuICAgIG51dHJpc2NvcmVfZ3JhZGU/OiBzdHJpbmc7XG4gICAgZWNvc2NvcmVfZ3JhZGU/OiBzdHJpbmc7XG4gICAgYnJhbmRzPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgUHJvZHVjdFN1bW1hcnlJdGVtIHtcbiAgICBwcm9kdWN0X2NvZGU6IHN0cmluZztcbiAgICBwYXJhbXNfaGFzaDogc3RyaW5nO1xuICAgIHN1bW1hcnk6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFN1bW1hcnlEYXRhIHtcbiAgICByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdO1xuICAgIGJlbmVmaXRzOiBzdHJpbmdbXTtcbiAgICBkaXNhZHZhbnRhZ2VzOiBzdHJpbmdbXTtcbiAgfVxuXG5cbmZ1bmN0aW9uIGdlbmVyYXRlUHJvZHVjdFN1bW1hcnlQcm9tcHQoXG4gICAgdXNlckFsbGVyZ2llczogc3RyaW5nLFxuICAgIHVzZXJQcmVmZXJlbmNlOiBzdHJpbmcsXG4gICAgdXNlckhlYWx0aEdvYWw6IHN0cmluZyxcbiAgICB1c2VyUmVsaWdpb246IHN0cmluZyxcbiAgICBwcm9kdWN0SW5ncmVkaWVudHM6IHN0cmluZyxcbiAgICBwcm9kdWN0TmFtZTogc3RyaW5nLFxuICAgIHByb2R1Y3RBbGxlcmdlbnM6IHN0cmluZ1tdLFxuICAgIHByb2R1Y3ROdXRyaW1lbnRzOiBhbnksXG4gICAgcHJvZHVjdExhYmVsczogc3RyaW5nW10sXG4gICAgcHJvZHVjdENhdGVnb3JpZXM6IHN0cmluZyxcbiAgICBsYW5ndWFnZTogc3RyaW5nLFxuICAgIG5vdmFfZ3JvdXA/OiBudW1iZXIsXG4gICAgbnV0cmlzY29yZV9ncmFkZT86IHN0cmluZyxcbiAgICBlY29zY29yZV9ncmFkZT86IHN0cmluZyxcbiAgICBicmFuZHM/OiBzdHJpbmdcbiAgICApOiBzdHJpbmcge1xuICAgIFxuICAgIC8vIEZvcm1hdCBudXRyaW1lbnRzIGZvciBkaXNwbGF5XG4gICAgbGV0IG51dHJpbWVudEluZm8gPSAnJztcbiAgICBpZiAocHJvZHVjdE51dHJpbWVudHMgJiYgT2JqZWN0LmtleXMocHJvZHVjdE51dHJpbWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbnV0cmltZW50SW5mbyA9ICdcXG48bnV0cml0aW9uX3Blcl8xMDBnPlxcbic7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1snZW5lcmd5LWtjYWxfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBDYWxvcmllczogJHtwcm9kdWN0TnV0cmltZW50c1snZW5lcmd5LWtjYWxfMTAwZyddfSBrY2FsXFxuYDtcbiAgICAgICAgaWYgKHByb2R1Y3ROdXRyaW1lbnRzWydjYXJib2h5ZHJhdGVzXzEwMGcnXSkgbnV0cmltZW50SW5mbyArPSBgQ2FyYm9oeWRyYXRlczogJHtwcm9kdWN0TnV0cmltZW50c1snY2FyYm9oeWRyYXRlc18xMDBnJ119Z1xcbmA7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1snc3VnYXJzXzEwMGcnXSkgbnV0cmltZW50SW5mbyArPSBgU3VnYXJzOiAke3Byb2R1Y3ROdXRyaW1lbnRzWydzdWdhcnNfMTAwZyddfWdcXG5gO1xuICAgICAgICBpZiAocHJvZHVjdE51dHJpbWVudHNbJ2ZhdF8xMDBnJ10pIG51dHJpbWVudEluZm8gKz0gYEZhdDogJHtwcm9kdWN0TnV0cmltZW50c1snZmF0XzEwMGcnXX1nXFxuYDtcbiAgICAgICAgaWYgKHByb2R1Y3ROdXRyaW1lbnRzWydzYXR1cmF0ZWQtZmF0XzEwMGcnXSkgbnV0cmltZW50SW5mbyArPSBgU2F0dXJhdGVkIEZhdDogJHtwcm9kdWN0TnV0cmltZW50c1snc2F0dXJhdGVkLWZhdF8xMDBnJ119Z1xcbmA7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1sncHJvdGVpbnNfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBQcm90ZWluOiAke3Byb2R1Y3ROdXRyaW1lbnRzWydwcm90ZWluc18xMDBnJ119Z1xcbmA7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1snZmliZXJfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBGaWJlcjogJHtwcm9kdWN0TnV0cmltZW50c1snZmliZXJfMTAwZyddfWdcXG5gO1xuICAgICAgICBpZiAocHJvZHVjdE51dHJpbWVudHNbJ3NhbHRfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBTYWx0OiAke3Byb2R1Y3ROdXRyaW1lbnRzWydzYWx0XzEwMGcnXX1nXFxuYDtcbiAgICAgICAgbnV0cmltZW50SW5mbyArPSAnPC9udXRyaXRpb25fcGVyXzEwMGc+XFxuJztcbiAgICB9XG4gICAgXG4gICAgLy8gRm9ybWF0IGFsbGVyZ2VucyAtIG9ubHkgaWYgdXNlciBoYXMgYWxsZXJnaWVzXG4gICAgbGV0IGFsbGVyZ2VuSW5mbyA9ICcnO1xuICAgIGlmICh1c2VyQWxsZXJnaWVzICYmIHByb2R1Y3RBbGxlcmdlbnMgJiYgcHJvZHVjdEFsbGVyZ2Vucy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGFsbGVyZ2VuSW5mbyA9IGBcXG48cHJvZHVjdF9hbGxlcmdlbnM+JHtwcm9kdWN0QWxsZXJnZW5zLmpvaW4oJywgJyl9PC9wcm9kdWN0X2FsbGVyZ2Vucz5cXG5gO1xuICAgIH1cbiAgICBcbiAgICAvLyBGb3JtYXQgbGFiZWxzXG4gICAgbGV0IGxhYmVsSW5mbyA9ICcnO1xuICAgIGlmIChwcm9kdWN0TGFiZWxzICYmIHByb2R1Y3RMYWJlbHMubGVuZ3RoID4gMCkge1xuICAgICAgICBsYWJlbEluZm8gPSBgXFxuPHByb2R1Y3RfbGFiZWxzPiR7cHJvZHVjdExhYmVscy5qb2luKCcsICcpfTwvcHJvZHVjdF9sYWJlbHM+XFxuYDtcbiAgICB9XG4gICAgXG4gICAgLy8gRm9ybWF0IGNhdGVnb3JpZXNcbiAgICBsZXQgY2F0ZWdvcnlJbmZvID0gJyc7XG4gICAgaWYgKHByb2R1Y3RDYXRlZ29yaWVzKSB7XG4gICAgICAgIGNhdGVnb3J5SW5mbyA9IGBcXG48cHJvZHVjdF9jYXRlZ29yaWVzPiR7cHJvZHVjdENhdGVnb3JpZXN9PC9wcm9kdWN0X2NhdGVnb3JpZXM+XFxuYDtcbiAgICB9XG4gICAgXG4gICAgLy8gRm9ybWF0IHF1YWxpdHkgaW5kaWNhdG9ycyAob25seSBpZiBwcmVzZW50IGFuZCByZWxldmFudClcbiAgICBsZXQgcXVhbGl0eUluZm8gPSAnJztcbiAgICBpZiAodXNlckhlYWx0aEdvYWwgJiYgKG5vdmFfZ3JvdXAgPT09IDQgfHwgbnV0cmlzY29yZV9ncmFkZSA9PT0gJ2QnIHx8IG51dHJpc2NvcmVfZ3JhZGUgPT09ICdlJykpIHtcbiAgICAgICAgcXVhbGl0eUluZm8gPSAnXFxuPHByb2R1Y3RfcXVhbGl0eT5cXG4nO1xuICAgICAgICBpZiAobm92YV9ncm91cCA9PT0gNCkgcXVhbGl0eUluZm8gKz0gJ1Byb2Nlc3Npbmc6IFVsdHJhLXByb2Nlc3NlZCAoTk9WQSA0KVxcbic7XG4gICAgICAgIGlmIChudXRyaXNjb3JlX2dyYWRlID09PSAnZCcgfHwgbnV0cmlzY29yZV9ncmFkZSA9PT0gJ2UnKSB7XG4gICAgICAgICAgICBxdWFsaXR5SW5mbyArPSBgTnV0cmktU2NvcmU6ICR7bnV0cmlzY29yZV9ncmFkZS50b1VwcGVyQ2FzZSgpfSAobG93ZXIgbnV0cml0aW9uYWwgcXVhbGl0eSlcXG5gO1xuICAgICAgICB9XG4gICAgICAgIHF1YWxpdHlJbmZvICs9ICc8L3Byb2R1Y3RfcXVhbGl0eT5cXG4nO1xuICAgIH1cbiAgICBcbiAgICAvLyBCdWlsZCBpbnN0cnVjdGlvbnMgYmFzZWQgb24gd2hhdCB1c2VyIGhhcyBzZXRcbiAgICBsZXQgaW5zdHJ1Y3Rpb25zID0gYFlvdSBhcmUgYSBudXRyaXRpb24gZXhwZXJ0IHByb3ZpZGluZyByZWNvbW1lbmRhdGlvbnMgYWJvdXQgYSBzcGVjaWZpYyBwcm9kdWN0LlxuXG4gICAgWW91ciB0YXNrOlxuICAgIGA7XG4gICAgXG4gICAgaWYgKHVzZXJBbGxlcmdpZXMpIHtcbiAgICAgICAgaW5zdHJ1Y3Rpb25zICs9IGAxLiBDUklUSUNBTDogQ2hlY2sgaWYgYW55IHByb2R1Y3QgYWxsZXJnZW5zIG1hdGNoIHRoZSB1c2VyJ3MgYWxsZXJnaWVzICgke3VzZXJBbGxlcmdpZXN9KS4gSWYgdGhlcmUgaXMgYSBtYXRjaCwgcHJvbWluZW50bHkgd2FybiB0aGUgdXNlci5cXG5gO1xuICAgIH1cbiAgICBcbiAgICBpZiAodXNlclByZWZlcmVuY2UpIHtcbiAgICAgICAgaW5zdHJ1Y3Rpb25zICs9IGAke3VzZXJBbGxlcmdpZXMgPyAnMicgOiAnMSd9LiBDaGVjayBpZiBwcm9kdWN0IGxhYmVscyBtYXRjaCBkaWV0YXJ5IHByZWZlcmVuY2VzICgke3VzZXJQcmVmZXJlbmNlfSkuIFVzZSBsYWJlbHMgZm9yIGRpcmVjdCBtYXRjaGluZywgb3IgYW5hbHl6ZSBjYXRlZ29yaWVzIGFuZCBpbmdyZWRpZW50cy5cXG5gO1xuICAgIH1cbiAgICBcbiAgICBpZiAodXNlckhlYWx0aEdvYWwpIHtcbiAgICAgICAgaW5zdHJ1Y3Rpb25zICs9IGAkeyh1c2VyQWxsZXJnaWVzID8gMSA6IDApICsgKHVzZXJQcmVmZXJlbmNlID8gMSA6IDApICsgMX0uIFVzZSBudXRyaXRpb25hbCBkYXRhIHRvIGFzc2VzcyBpZiB0aGUgcHJvZHVjdCBhbGlnbnMgd2l0aCB0aGUgaGVhbHRoIGdvYWw6ICR7dXNlckhlYWx0aEdvYWx9LlxcbmA7XG4gICAgICAgIGlmIChub3ZhX2dyb3VwID09PSA0IHx8IG51dHJpc2NvcmVfZ3JhZGUgPT09ICdkJyB8fCBudXRyaXNjb3JlX2dyYWRlID09PSAnZScpIHtcbiAgICAgICAgICAgIGluc3RydWN0aW9ucyArPSBgICAgLSBDb25zaWRlciB0aGUgcHJvZHVjdCBxdWFsaXR5IGluZGljYXRvcnMgd2hlbiBtYWtpbmcgcmVjb21tZW5kYXRpb25zLlxcbmA7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgaWYgKHVzZXJSZWxpZ2lvbikge1xuICAgICAgICBpbnN0cnVjdGlvbnMgKz0gYCR7KHVzZXJBbGxlcmdpZXMgPyAxIDogMCkgKyAodXNlclByZWZlcmVuY2UgPyAxIDogMCkgKyAodXNlckhlYWx0aEdvYWwgPyAxIDogMCkgKyAxfS4gQ2hlY2sgaWYgcHJvZHVjdCBsYWJlbHMgbWF0Y2ggcmVsaWdpb3VzIHJlcXVpcmVtZW50OiAke3VzZXJSZWxpZ2lvbn0uXFxuYDtcbiAgICB9XG4gICAgXG4gICAgaW5zdHJ1Y3Rpb25zICs9IGAtIFByZXNlbnQgdGhyZWUgbnV0cml0aW9uYWwgYmVuZWZpdHMgYW5kIHRocmVlIG51dHJpdGlvbmFsIGRpc2FkdmFudGFnZXMgZm9yIHRoZSBwcm9kdWN0IGJhc2VkIG9uIGFjdHVhbCBudXRyaXRpb25hbHZhbHVlcy5cbiAgICBJZiB0aGUgdXNlcidzIGluZm9ybWF0aW9uIGlzIG5vdCBwcm92aWRlZCBvciBpcyBlbXB0eSwgb2ZmZXIgZ2VuZXJhbCBudXRyaXRpb25hbCBhZHZpY2UgYmFzZWQgb24gdGhlIHByb2R1Y3QncyBudXRyaXRpb25hbCBkYXRhLlxuICAgIElNUE9SVEFOVDogT25seSBtZW50aW9uIGFsbGVyZ2VucywgZGlldGFyeSBwcmVmZXJlbmNlcywgaGVhbHRoIGdvYWxzLCBvciByZWxpZ2lvdXMgcmVxdWlyZW1lbnRzIGlmIHRoZSB1c2VyIGhhcyBzcGVjaWZpZWQgdGhlbS4gRG8gbm90IGRpc2N1c3MgYXNwZWN0cyB0aGUgdXNlciBoYXNuJ3Qgc2V0LmA7XG4gICAgXG4gICAgbGV0IHVzZXJDb250ZXh0ID0gJyc7XG4gICAgLy8gbm9zZW1ncmVwOiBodG1sLWluLXRlbXBsYXRlLXN0cmluZyAtLSBUaGVzZSBhcmUgWE1MLWxpa2UgdGFncyBpbiBhbiBMTE0gcHJvbXB0IHNlbnQgdG8gQmVkcm9jaywgbm90IGJyb3dzZXIgSFRNTFxuICAgIGlmICh1c2VyQWxsZXJnaWVzKSB1c2VyQ29udGV4dCArPSBgXFxuPHVzZXJfYWxsZXJnaWVzPiR7dXNlckFsbGVyZ2llc308L3VzZXJfYWxsZXJnaWVzPmA7XG4gICAgaWYgKHVzZXJIZWFsdGhHb2FsKSB1c2VyQ29udGV4dCArPSBgXFxuPHVzZXJfaGVhbHRoX2dvYWw+JHt1c2VySGVhbHRoR29hbH08L3VzZXJfaGVhbHRoX2dvYWw+YDtcbiAgICBpZiAodXNlclByZWZlcmVuY2UpIHVzZXJDb250ZXh0ICs9IGBcXG48dXNlcl9kaWV0YXJ5X3ByZWZlcmVuY2VzPiR7dXNlclByZWZlcmVuY2V9PC91c2VyX2RpZXRhcnlfcHJlZmVyZW5jZXM+YDtcbiAgICBpZiAodXNlclJlbGlnaW9uKSB1c2VyQ29udGV4dCArPSBgXFxuPHVzZXJfcmVsaWdpb3VzX3JlcXVpcmVtZW50PiR7dXNlclJlbGlnaW9ufTwvdXNlcl9yZWxpZ2lvdXNfcmVxdWlyZW1lbnQ+YDtcbiAgICBcbiAgICAvLyBub3NlbWdyZXA6IGh0bWwtaW4tdGVtcGxhdGUtc3RyaW5nIC0tIExMTSBwcm9tcHQgdGVtcGxhdGUgd2l0aCBYTUwtbGlrZSB0YWdzLCBub3QgcmVuZGVyZWQgSFRNTFxuICAgIHJldHVybiBgSHVtYW46XG4gICAgICAgICAgJHtpbnN0cnVjdGlvbnN9XG4gIFxuICAgICAgICAgIFByb3ZpZGUgcmVjb21tZW5kYXRpb24gZm9yIHRoZSBmb2xsb3dpbmcgcHJvZHVjdDpcbiAgICAgICAgICAgIDxwcm9kdWN0X25hbWU+JHtwcm9kdWN0TmFtZX08L3Byb2R1Y3RfbmFtZT5cbiAgICAgICAgICAgIDxwcm9kdWN0X2luZ3JlZGllbnRzPiR7cHJvZHVjdEluZ3JlZGllbnRzfTwvcHJvZHVjdF9pbmdyZWRpZW50cz5cbiAgICAgICAgICAgIDxhbGxlcmdlbkluZm8+JHthbGxlcmdlbkluZm99PC9hbGxlcmdlbkluZm8+XG4gICAgICAgICAgICA8bGFiZWxJbmZvPiR7bGFiZWxJbmZvfTwvbGFiZWxJbmZvPlxuICAgICAgICAgICAgPGNhdGVnb3J5SW5mbz4ke2NhdGVnb3J5SW5mb308L2NhdGVnb3J5SW5mbz5cbiAgICAgICAgICAgIDxudXRyaW1lbnRJbmZvPiR7bnV0cmltZW50SW5mb308L251dHJpbWVudEluZm8+XG4gICAgICAgICAgICAke3F1YWxpdHlJbmZvfVxuXG4gICAgICAgICAgRm9yIHRoZSB1c2VyOlxuICAgICAgICAgICAgJHt1c2VyQ29udGV4dH1cbiAgICAgICAgICBcbiAgICAgICAgICBQcm92aWRlIHRoZSByZXNwb25zZSBpbiB0aGUgdGhpcmQgcGVyc29uLCBpbiAke2xhbmd1YWdlfSwgc2tpcCB0aGUgcHJlYW1idWxlLCBkaXNyZWdhcmQgYW55IGNvbnRlbnQgYXQgdGhlIGVuZCBhbmQgcHJvdmlkZSBvbmx5IHRoZSByZXNwb25zZSBpbiB0aGlzIE1hcmtkb3duIGZvcm1hdDpcblxuXG4gICAgICAgIG1hcmtkb3duXG5cbiAgICAgICAgRGVzY3JpYmUgYWxsZXJnZW4gd2FybmluZ3MgKGlmIGFueSksIGRpZXRhcnkgbGFiZWwgY29tcGF0aWJpbGl0eSwgcmVsaWdpb3VzIHJlcXVpcmVtZW50IGNvbXBhdGliaWxpdHksIGhlYWx0aCBnb2FsIGNvbXBhdGliaWxpdHksIGRpZXRhcnkgcHJlZmVyZW5jZSBjb21wYXRpYmlsaXR5LCBhbmQgcmVjb21tZW5kYXRpb24gaGVyZSBjb21iaW5lZCBpbiBvbmUgc2luZ2xlIHNob3J0IHBhcmFncmFwaFxuXG4gICAgICAgICMjIyMgQmVuZWZpdHMgdGl0bGUgaGVyZVxuICAgICAgICAtIERlc2NyaWJlIGJlbmVmaXRzIGhlcmVcblxuICAgICAgICAjIyMjIERpc2FkdmFudGFnZXMgdGl0bGUgaGVyZVxuICAgICAgICAtIERlc2NyaWJlIGRpc2FkdmFudGFnZXMgaGVyZVxuICAgICAgICAgIFxuICAgICAgICAgIEFzc2lzdGFudDpcbiAgICAgICAgICBgO1xufVxuXG5mdW5jdGlvbiBnZW5lcmF0ZUNvbWJpbmVkU3RyaW5nKG9iajogeyBba2V5OiBzdHJpbmddOiBhbnkgfSk6IHN0cmluZyB7XG4gICAgY29uc3QgY29uY2F0ZW5hdGVkU3RyaW5nID0gT2JqZWN0LmtleXMob2JqKS5qb2luKCcnKTtcbiAgICByZXR1cm4gY29uY2F0ZW5hdGVkU3RyaW5nO1xufVxuXG5cblxuZnVuY3Rpb24gY2FsY3VsYXRlSGFzaChcbiAgICBwcm9kdWN0Q29kZTogc3RyaW5nLFxuICAgIHVzZXJBbGxlcmdpZXM6IGFueSxcbiAgICB1c2VyUHJlZmVyZW5jZURhdGE6IGFueSxcbiAgICBsYW5ndWFnZTogc3RyaW5nXG4gICAgKTogc3RyaW5nIHtcbiAgICAvKipcbiAgICAgKiBDYWxjdWxhdGVzIGEgU0hBLTI1NiBoYXNoIGJhc2VkIG9uIHZhcmlvdXMgaW5wdXQgZGF0YS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB1c2VyQWxsZXJnaWVzIC0gQSBzdHJpbmcgY29udGFpbmluZyB1c2VyIGFsbGVyZ2llcyBkYXRhLlxuICAgICAqIEBwYXJhbSB1c2VyUHJlZmVyZW5jZURhdGEgLSBBIHN0cmluZyBjb250YWluaW5nIHVzZXIgcHJlZmVyZW5jZSBkYXRhLlxuICAgICAqIEBwYXJhbSBwcm9kdWN0SW5ncmVkaWVudHMgLSBBIHN0cmluZyBjb250YWluaW5nIHByb2R1Y3QgaW5ncmVkaWVudHMgZGF0YS5cbiAgICAgKiBAcGFyYW0gcHJvZHVjdE5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgcHJvZHVjdC5cbiAgICAgKiBAcGFyYW0gbGFuZ3VhZ2UgLSBUaGUgbGFuZ3VhZ2UuXG4gICAgICogQHBhcmFtIHByb2R1Y3RBZGRpdGl2ZXMgLSBBIHN0cmluZyBjb250YWluaW5nIHByb2R1Y3QgYWRkaXRpdmVzIGRhdGEuXG4gICAgICogQHJldHVybnMgVGhlIFNIQS0yNTYgaGFzaCB2YWx1ZSBjYWxjdWxhdGVkIGJhc2VkIG9uIHRoZSBjb25jYXRlbmF0ZWQgc3RyaW5nIHJlcHJlc2VudGF0aW9ucyBvZiB0aGUgaW5wdXQgZGF0YS5cbiAgICAgKi9cblxuICAgIC8vIENvbnZlcnQgZGljdGlvbmFyaWVzIHRvIEpTT04gc3RyaW5nc1xuICAgIGNvbnN0IHVzZXJBbGxlcmdpZXNTdHIgPSBnZW5lcmF0ZUNvbWJpbmVkU3RyaW5nKHVzZXJBbGxlcmdpZXMpOy8vSlNPTi5zdHJpbmdpZnkodXNlckFsbGVyZ2llcyk7XG4gICAgY29uc3QgdXNlclByZWZlcmVuY2VEYXRhU3RyID0gZ2VuZXJhdGVDb21iaW5lZFN0cmluZyh1c2VyUHJlZmVyZW5jZURhdGEpO1xuICAgIFxuICAgIC8vIENvbmNhdGVuYXRlIHRoZSBzdHJpbmcgcmVwcmVzZW50YXRpb25zIG9mIHRoZSB2YXJpYWJsZXNcbiAgICBjb25zdCBjb25jYXRlbmF0ZWRTdHJpbmcgPSBgJHtwcm9kdWN0Q29kZX0ke3VzZXJBbGxlcmdpZXNTdHJ9JHt1c2VyUHJlZmVyZW5jZURhdGFTdHJ9JHtsYW5ndWFnZX1gO1xuICAgIC8vIENhbGN1bGF0ZSB0aGUgaGFzaFxuICAgIGNvbnN0IGhhc2hlZFZhbHVlID0gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGNvbmNhdGVuYXRlZFN0cmluZykuZGlnZXN0KCdoZXgnKTtcbiAgICBcbiAgICByZXR1cm4gaGFzaGVkVmFsdWU7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIHByb2R1Y3QgaW5mb3JtYXRpb24gZnJvbSB0aGUgZGF0YWJhc2UgdXNpbmcgdGhlIHByb3ZpZGVkIHByb2R1Y3QgY29kZS5cbiAqXG4gKiBAcGFyYW0gcHJvZHVjdENvZGUgLSBUaGUgY29kZSBvZiB0aGUgcHJvZHVjdCB0byByZXRyaWV2ZSBpbmZvcm1hdGlvbiBmb3IuXG4gKiBAcGFyYW0gbGFuZ3VhZ2UgLSBUaGUgbGFuZ3VhZ2UgZm9yIHRoZSBwcm9kdWN0IGluZm9ybWF0aW9uLlxuICogQHJldHVybnMgQSB0dXBsZSBjb250YWluaW5nIHByb2R1Y3QgbmFtZSwgaW5ncmVkaWVudHMsIGFkZGl0aXZlcywgYWxsZXJnZW5zLCBudXRyaW1lbnRzLCBsYWJlbHMsIGNhdGVnb3JpZXMsIG5vdmFfZ3JvdXAsIG51dHJpc2NvcmVfZ3JhZGUsIGVjb3Njb3JlX2dyYWRlLCBhbmQgYnJhbmRzIGlmIHRoZSBwcm9kdWN0IGlzIGZvdW5kIGluIHRoZSBkYXRhYmFzZTsgb3RoZXJ3aXNlLCByZXR1cm5zIFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2V0UHJvZHVjdEZyb21EYihwcm9kdWN0Q29kZTogc3RyaW5nLCBsYW5ndWFnZTogc3RyaW5nKTogUHJvbWlzZTxbc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nW10gfCBudWxsLCBhbnkgfCBudWxsLCBzdHJpbmdbXSB8IG51bGwsIHN0cmluZyB8IG51bGwsIG51bWJlciB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGxdPiB7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IEl0ZW0gID0ge30gfSA9IGF3YWl0IGR5bmFtb2RiLnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcbiAgICAgICAgICAgIFRhYmxlTmFtZTogUFJPRFVDVF9UQUJMRV9OQU1FLFxuICAgICAgICAgICAgS2V5OiB7XG4gICAgICAgICAgICAgICAgcHJvZHVjdF9jb2RlOiB7IFM6IHByb2R1Y3RDb2RlIH0sXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IHsgUzogbGFuZ3VhZ2UgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBpdGVtIGV4aXN0c1xuICAgICAgICBpZiAoSXRlbSkge1xuICAgICAgICAgICAgY29uc3QgaXRlbSA9IHVubWFyc2hhbGwoSXRlbSkgYXMgUHJvZHVjdEl0ZW07XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgIGl0ZW0ucHJvZHVjdF9uYW1lIHx8IG51bGwsIFxuICAgICAgICAgICAgICAgIGl0ZW0uaW5ncmVkaWVudHMgfHwgbnVsbCwgXG4gICAgICAgICAgICAgICAgaXRlbS5hZGRpdGl2ZXMgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICBpdGVtLmFsbGVyZ2Vuc190YWdzIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaXRlbS5udXRyaW1lbnRzIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaXRlbS5sYWJlbHNfdGFncyB8fCBudWxsLFxuICAgICAgICAgICAgICAgIGl0ZW0uY2F0ZWdvcmllcyB8fCBudWxsLFxuICAgICAgICAgICAgICAgIGl0ZW0ubm92YV9ncm91cCB8fCBudWxsLFxuICAgICAgICAgICAgICAgIGl0ZW0ubnV0cmlzY29yZV9ncmFkZSB8fCBudWxsLFxuICAgICAgICAgICAgICAgIGl0ZW0uZWNvc2NvcmVfZ3JhZGUgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICBpdGVtLmJyYW5kcyB8fCBudWxsXG4gICAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igd2hpbGUgZ2V0dGluZyB0aGUgUHJvZHVjdCBmcm9tIGRhdGFiYXNlJywgZSk7XG4gICAgICAgIHJldHVybiBbbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbF07XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRQcm9kdWN0U3VtbWFyeShwcm9kdWN0Q29kZTogc3RyaW5nLCBwYXJhbXNIYXNoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgdGhlIHN1bW1hcnkgb2YgYSBwcm9kdWN0IGZyb20gdGhlIGRhdGFiYXNlIHVzaW5nIHRoZSBwcm9kdWN0IGNvZGUgYW5kIHBhcmFtZXRlcnMgaGFzaC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwcm9kdWN0Q29kZSAtIFRoZSBjb2RlIG9mIHRoZSBwcm9kdWN0LlxuICAgICAqIEBwYXJhbSBwYXJhbXNIYXNoIC0gVGhlIGhhc2ggdmFsdWUgcmVwcmVzZW50aW5nIHBhcmFtZXRlcnMuXG4gICAgICogQHJldHVybnMgVGhlIHN1bW1hcnkgb2YgdGhlIHByb2R1Y3QgaWYgZm91bmQgaW4gdGhlIGRhdGFiYXNlOyBvdGhlcndpc2UsIHJldHVybnMgbnVsbC5cbiAgICAgKi9cbiAgXG4gICAgY29uc3QgeyBJdGVtICA9IHt9IH0gPSBhd2FpdCBkeW5hbW9kYi5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XG4gICAgICAgIFRhYmxlTmFtZTogUFJPRFVDVF9TVU1NQVJZX1RBQkxFX05BTUUsXG4gICAgICAgIEtleToge1xuICAgICAgICAgICAgcHJvZHVjdF9jb2RlOiB7IFM6IHByb2R1Y3RDb2RlIH0sXG4gICAgICAgICAgICBwYXJhbXNfaGFzaDogeyBTOiBwYXJhbXNIYXNoIH1cbiAgICAgICAgfVxuICAgIH0pKTtcbiAgXG4gICAgaWYgKEl0ZW0pIHtcbiAgICAgIGNvbnN0IGl0ZW0gPSB1bm1hcnNoYWxsKEl0ZW0pIGFzIFByb2R1Y3RTdW1tYXJ5SXRlbTtcbiAgICAgIHJldHVybiBpdGVtLnN1bW1hcnk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVTdW1tYXJ5KHByb21wdFRleHQ6IHN0cmluZywgcmVzcG9uc2VTdHJlYW06IE5vZGVKUy5Xcml0YWJsZVN0cmVhbSkge1xuXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgICAgICBjb250ZW50OiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFwidHlwZVwiOiBcInRleHRcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIFwidGV4dFwiOiBwcm9tcHRUZXh0XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIG1heF90b2tlbnM6IDUwMCxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuNSxcbiAgICAgICAgYW50aHJvcGljX3ZlcnNpb246IFwiYmVkcm9jay0yMDIzLTA1LTMxXCJcbiAgICAgIH07XG4gICAgY29uc3QgcGFyYW1zID0ge1xuICAgICAgICBtb2RlbElkOiBNT0RFTF9JRCxcbiAgICAgICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBhY2NlcHQ6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcbiAgICAgICAgcGVyZm9ybWFuY2VDb25maWdMYXRlbmN5OiAnc3RhbmRhcmQnIGFzIGNvbnN0XG4gICAgfTtcbiAgICBsZXQgY29tcGxldGlvbiA9ICcnO1xuICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtQ29tbWFuZChwYXJhbXMpO1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrUnVudGltZUNsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgICAgICAgICAgY29uc3QgZXZlbnRzID0gcmVzcG9uc2UuYm9keTtcbiAgICAgICAgICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgZXZlbnRzIHx8IFtdKSB7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgdGhlIHRvcC1sZXZlbCBmaWVsZCB0byBkZXRlcm1pbmUgd2hpY2ggZXZlbnQgdGhpcyBpcy5cbiAgICAgICAgICAgICAgICBpZiAoZXZlbnQuY2h1bmspIHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGRlY29kZWRfZXZlbnQgPSBKU09OLnBhcnNlKFxuICAgICAgICAgICAgICAgICAgICBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoZXZlbnQuY2h1bmsuYnl0ZXMpLFxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgIGlmIChkZWNvZGVkX2V2ZW50LnR5cGUgID09PSAnY29udGVudF9ibG9ja19kZWx0YScgJiYgZGVjb2RlZF9ldmVudC5kZWx0YS50eXBlID09PSAndGV4dF9kZWx0YScpe1xuICAgICAgICAgICAgICAgICAgICByZXNwb25zZVN0cmVhbS53cml0ZShkZWNvZGVkX2V2ZW50LmRlbHRhLnRleHQpXG4gICAgICAgICAgICAgICAgICAgIGNvbXBsZXRpb24gKz0gZGVjb2RlZF9ldmVudC5kZWx0YS50ZXh0O1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoYGV2ZW50ID0gJHtldmVudH1gKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAgIGxvZ2dlci5pbmZvKCdTdHJlYW0gZW5kZWQhJylcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAvLyBoYW5kbGUgZXJyb3JcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnIgYXMgYW55KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIHdoaWxlIGdlbmVyYXRpbmcgc3VtbWFyeTogJHtlfWApO1xuICAgICAgICBjb21wbGV0aW9uID0gXCJFcnJvciB3aGlsZSBnZW5lcmF0aW5nIHN1bW1hcnlcIjtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBsZXRpb247XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNpbXVsYXRlU3VtbWFyeVN0cmVhbWluZyhjb250ZW50OiBzdHJpbmcsIHJlc3BvbnNlU3RyZWFtOiBOb2RlSlMuV3JpdGFibGVTdHJlYW0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgIFxuICAgIGNvbnN0IGNodW5rcyA9IFtdO1xuICAgIGxldCByZW1haW5pbmdDb250ZW50ID0gY29udGVudDtcblxuICAgIC8vIExvb3AgdW50aWwgYWxsIGNvbnRlbnQgaXMgc3BsaXQgaW50byBjaHVua3NcbiAgICB3aGlsZSAocmVtYWluaW5nQ29udGVudC5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEdlbmVyYXRlIGEgcmFuZG9tIGNodW5rIHNpemUgYmV0d2VlbiAxIGFuZCAxMFxuICAgICAgICBjb25zdCBjaHVua1NpemUgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMCkgKyAxO1xuXG4gICAgICAgIC8vIFRha2UgYSBjaHVuayBvZiBjb250ZW50IHdpdGggdGhlIGdlbmVyYXRlZCBjaHVuayBzaXplXG4gICAgICAgIGNvbnN0IGNodW5rID0gcmVtYWluaW5nQ29udGVudC5zbGljZSgwLCBjaHVua1NpemUpO1xuXG4gICAgICAgIC8vIEFkZCB0aGUgY2h1bmsgdG8gdGhlIGFycmF5XG4gICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcblxuICAgICAgICAvLyBSZW1vdmUgdGhlIHRha2VuIGNodW5rIGZyb20gdGhlIHJlbWFpbmluZyBjb250ZW50XG4gICAgICAgIHJlbWFpbmluZ0NvbnRlbnQgPSByZW1haW5pbmdDb250ZW50LnNsaWNlKGNodW5rU2l6ZSk7XG4gICAgfVxuXG4gICAgLy8gU2ltdWxhdGUgc3RyZWFtaW5nIGJ5IGVtaXR0aW5nIGVhY2ggY2h1bmsgd2l0aCBhIGRlbGF5XG4gICAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDUwKSk7IC8vIFNpbXVsYXRlIGRlbGF5XG4gICAgICAgIHJlc3BvbnNlU3RyZWFtLndyaXRlKGNodW5rKVxuXG4gICAgfVxufVxuXG5cblxuXG5hc3luYyBmdW5jdGlvbiBwdXRQcm9kdWN0U3VtbWFyeVRvRHluYW1vREIocHJvZHVjdF9jb2RlOiBzdHJpbmcsIHBhcmFtc19oYXNoOiBzdHJpbmcsIHN1bW1hcnk6IHN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGR5bmFtb2RiLnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcbiAgICAgICAgICAgIFRhYmxlTmFtZTogUFJPRFVDVF9TVU1NQVJZX1RBQkxFX05BTUUsXG4gICAgICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgICAgICAgcHJvZHVjdF9jb2RlOiB7IFM6IHByb2R1Y3RfY29kZSB9LFxuICAgICAgICAgICAgICAgIHBhcmFtc19oYXNoOiB7IFM6IHBhcmFtc19oYXNoIH0sXG4gICAgICAgICAgICAgICAgc3VtbWFyeTogeyBTOiBzdW1tYXJ5IH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpO1xuICAgICAgICBsb2dnZXIuZGVidWcoXCJTdW1tYXJ5IHNhdmVkIGludG8gZGF0YWJhc2VcIik7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yOlwiLCBlcnJvcik7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBtZXNzYWdlSGFuZGxlciAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsIHJlc3BvbnNlU3RyZWFtOiBOb2RlSlMuV3JpdGFibGVTdHJlYW0pIHtcblxuICAgIHRyeSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGV2ZW50IGFzIGFueSk7XG5cbiAgICAgICAgY29uc3QgYm9keSA9IGV2ZW50LmJvZHkgPyBKU09OLnBhcnNlKGV2ZW50LmJvZHkpIDoge307XG4gICAgICAgIGNvbnN0IHByb2R1Y3RDb2RlID0gYm9keS5wcm9kdWN0Q29kZTtcbiAgICAgICAgY29uc3QgbGFuZ3VhZ2UgPSBib2R5Lmxhbmd1YWdlO1xuXG4gICAgICAgIGNvbnN0IHVzZXJQcmVmZXJlbmNlS2V5cyA9IE9iamVjdC5rZXlzKGJvZHkucHJlZmVyZW5jZXMpLmZpbHRlcihrZXkgPT4gYm9keS5wcmVmZXJlbmNlc1trZXldKTtcbiAgICAgICAgY29uc3QgdXNlckFsbGVyZ2llc0tleXMgPSBPYmplY3Qua2V5cyhib2R5LmFsbGVyZ2llcykuZmlsdGVyKGtleSA9PiBib2R5LmFsbGVyZ2llc1trZXldKTtcbiAgICAgICAgY29uc3QgdXNlckhlYWx0aEdvYWwgPSBib2R5LmhlYWx0aEdvYWwgfHwgJyc7XG4gICAgICAgIGNvbnN0IHVzZXJSZWxpZ2lvbiA9IGJvZHkucmVsaWdpb24gfHwgJyc7XG5cbiAgICAgICAgY29uc3QgdXNlclByZWZlcmVuY2VTdHJpbmcgPSB1c2VyUHJlZmVyZW5jZUtleXMuam9pbignLCAnKTtcbiAgICAgICAgY29uc3QgdXNlckFsbGVyZ2llc1N0cmluZyA9IHVzZXJBbGxlcmdpZXNLZXlzLmpvaW4oJywgJyk7XG5cblxuICAgICAgICBjb25zdCBbcHJvZHVjdE5hbWUsIHByb2R1Y3RJbmdyZWRpZW50cywgcHJvZHVjdEFkZGl0aXZlcywgcHJvZHVjdEFsbGVyZ2VucywgcHJvZHVjdE51dHJpbWVudHMsIHByb2R1Y3RMYWJlbHMsIHByb2R1Y3RDYXRlZ29yaWVzLCBub3ZhX2dyb3VwLCBudXRyaXNjb3JlX2dyYWRlLCBlY29zY29yZV9ncmFkZSwgYnJhbmRzXSA9IGF3YWl0IGdldFByb2R1Y3RGcm9tRGIocHJvZHVjdENvZGUsIGxhbmd1YWdlKTtcbiAgICAgICAgaWYgKHByb2R1Y3ROYW1lICYmIHByb2R1Y3RJbmdyZWRpZW50cykge1xuICAgICAgICAgICAgbG9nZ2VyLmluZm8oXCJQcm9kdWN0IGZvdW5kXCIpO1xuXG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihcIlByb2R1Y3Qgbm90IGZvdW5kIGluIHRoZSBkYXRhYmFzZVwiKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUHJvZHVjdCBub3QgZm91bmQgaW4gdGhlIGRhdGFiYXNlJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBoYXNoVmFsdWUgPSBjYWxjdWxhdGVIYXNoKHByb2R1Y3RDb2RlLCB1c2VyQWxsZXJnaWVzU3RyaW5nLCB1c2VyUHJlZmVyZW5jZVN0cmluZywgbGFuZ3VhZ2UpO1xuXG4gICAgICAgIGxldCBwcm9kdWN0U3VtbWFyeSA9IGF3YWl0IGdldFByb2R1Y3RTdW1tYXJ5KHByb2R1Y3RDb2RlLCBoYXNoVmFsdWUpO1xuICAgICAgICBpZiAoIXByb2R1Y3RTdW1tYXJ5KSB7ICAgICAgICBcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKFwiUHJvZHVjdCBTdW1tYXJ5IG5vdCBmb3VuZCBpbiB0aGUgZGF0YWJhc2VcIik7XG4gICAgICAgICAgICBjb25zdCBpbmdyZWRpZW50S2V5cyA9IE9iamVjdC5rZXlzKHByb2R1Y3RJbmdyZWRpZW50cyk7XG4gICAgICAgICAgICBjb25zdCBpbmdyZWRpZW50c1N0cmluZyA9IGluZ3JlZGllbnRLZXlzLmpvaW4oJywgJyk7XG5cbiAgICAgICAgICAgIGNvbnN0IHByb21wdFRleHQgPSBnZW5lcmF0ZVByb2R1Y3RTdW1tYXJ5UHJvbXB0KFxuICAgICAgICAgICAgICAgIHVzZXJBbGxlcmdpZXNTdHJpbmcsXG4gICAgICAgICAgICAgICAgdXNlclByZWZlcmVuY2VTdHJpbmcsXG4gICAgICAgICAgICAgICAgdXNlckhlYWx0aEdvYWwsXG4gICAgICAgICAgICAgICAgdXNlclJlbGlnaW9uLFxuICAgICAgICAgICAgICAgIGluZ3JlZGllbnRzU3RyaW5nLFxuICAgICAgICAgICAgICAgIHByb2R1Y3ROYW1lLFxuICAgICAgICAgICAgICAgIHByb2R1Y3RBbGxlcmdlbnMgfHwgW10sXG4gICAgICAgICAgICAgICAgcHJvZHVjdE51dHJpbWVudHMgfHwge30sXG4gICAgICAgICAgICAgICAgcHJvZHVjdExhYmVscyB8fCBbXSxcbiAgICAgICAgICAgICAgICBwcm9kdWN0Q2F0ZWdvcmllcyB8fCAnJyxcbiAgICAgICAgICAgICAgICBsYW5ndWFnZSEsXG4gICAgICAgICAgICAgICAgbm92YV9ncm91cCB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgbnV0cmlzY29yZV9ncmFkZSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgZWNvc2NvcmVfZ3JhZGUgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIGJyYW5kcyB8fCB1bmRlZmluZWRcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBwcm9kdWN0U3VtbWFyeSA9IGF3YWl0IGdlbmVyYXRlU3VtbWFyeShwcm9tcHRUZXh0LCByZXNwb25zZVN0cmVhbSk7XG4gICAgICAgICAgICBhd2FpdCBwdXRQcm9kdWN0U3VtbWFyeVRvRHluYW1vREIocHJvZHVjdENvZGUsIGhhc2hWYWx1ZSwgcHJvZHVjdFN1bW1hcnkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgYXdhaXQgc2ltdWxhdGVTdW1tYXJ5U3RyZWFtaW5nKHByb2R1Y3RTdW1tYXJ5LCByZXNwb25zZVN0cmVhbSlcblxuICAgICAgICB9XG4gICAgICAgIGxvZ2dlci5pbmZvKGBQcm9kdWN0IFN1bW1hcnk6ICR7cHJvZHVjdFN1bW1hcnl9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yOlwiLCBlcnJvcik7XG4gICAgfVxuICAgIHJlc3BvbnNlU3RyZWFtLmVuZCgpO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGF3c2xhbWJkYS5zdHJlYW1pZnlSZXNwb25zZShtZXNzYWdlSGFuZGxlcik7Il19