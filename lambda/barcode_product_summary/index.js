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
        userContext += `\n<user_religious_requirement>${userReligion}</user_religious_requirement>`; // nosemgrep: html-in-template-string
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

          1. Use the user's allergy information, if provided, to ensure that the ingredients in the product are suitable for the user.
          2. Use the user's preferences, if provided, to ensure that the user will enjoy the product. Note that the product can contain additives listed in the additives. Make sure these additives are compatible with user allergies and preferences.
          3. Present three benefits and three disadvantages for the product, ensuring that each list consists of precisely three points.
          4. Provide nutritional recommendations for the product based on its ingredients and the user's needs.
  
          If the user's allergy information or preferences are not provided or are empty, offer general nutritional advice on the product.
  
          Example:
          <product_name>Chocolate and hazelnut spread</product_name>
          <product_ingredients>
          {{
              Sucre, sirop de glucose, NOISETTES entières torréfiées, matières grasses végétales (palme, karité), beurre de cacao¹, LAIT entier en poudre, PETIT-LAIT filtré en poudre, LAIT écrémé concentré sucré (LAIT écrémé, sucre), sirop de glucose-fructose, pâte de cacao¹, blancs d'ŒUFS en poudre, émulsifiant (lécithines). Peut contenir ARACHIDES, autres FRUITS À COQUE (AMANDES, NOIX DE CAJOU, NOIX DE PECAN) et SOJA. ¹Bilan massique certifié Rainforest Alliance. www.ra.org/fr.
          }}
          </product_ingredients>
          <user_allergies></user_allergies>
          <user_preferences>I don't like chocolate</user_preferences>
          </example>
          Response: 
          <data>
              <recommendations>
                  <recommendation>
                  Although Nutella contains a small amount of calcium and iron, it's not very nutritious and high in sugar, calories and fat.
                  </recommendation>
              </recommendations>
              <benefits>
                  <benefit>{{benefit}}</benefit>
              </benefits>
              <disadvantages>
                  <disadvantage>{{disadvantage}}</disadvantage>
              </disadvantages>                 
          </data>
  
          Provide recommendation for the following product
          <product_name>${productName}</product_name>
          <product_ingredients>
          ${productIngredients}
          </product_ingredients>
          <user_allergies>${userAllergies}</user_allergies>
          <user_preferences>${userPreference}</user_preferences>
          Provide the response in the third person, in ${language}, skip the preambule, disregard any content at the end and provide only the response in this Markdown format:


        markdown

        Describe potential_health_issues, preference_matter and recommendation here combines in one single short paragraph

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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEY7QUFDMUYsMERBQW9EO0FBRXBELDBEQUF1RDtBQUV2RCxtQ0FBb0M7QUFDcEMsNEVBQTZHO0FBRTdHLE1BQU0sTUFBTSxHQUFHLElBQUksZUFBTSxFQUFFLENBQUM7QUFDNUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBRXhDLE1BQU0sa0JBQWtCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQTtBQUN6RCxNQUFNLDBCQUEwQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLENBQUE7QUFDekUsTUFBTSxRQUFRLEdBQUcsNkNBQTZDLENBQUE7QUFJOUQsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUE4Q3JHLFNBQVMsNEJBQTRCLENBQ2pDLGFBQXFCLEVBQ3JCLGNBQXNCLEVBQ3RCLGNBQXNCLEVBQ3RCLFlBQW9CLEVBQ3BCLGtCQUEwQixFQUMxQixXQUFtQixFQUNuQixnQkFBMEIsRUFDMUIsaUJBQXNCLEVBQ3RCLGFBQXVCLEVBQ3ZCLGlCQUF5QixFQUN6QixRQUFnQixFQUNoQixVQUFtQixFQUNuQixnQkFBeUIsRUFDekIsY0FBdUIsRUFDdkIsTUFBZTtJQUdmLGdDQUFnQztJQUNoQyxJQUFJLGFBQWEsR0FBRyxFQUFFLENBQUM7SUFDdkIsSUFBSSxpQkFBaUIsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtRQUNoRSxhQUFhLEdBQUcsMEJBQTBCLENBQUM7UUFDM0MsSUFBSSxpQkFBaUIsQ0FBQyxrQkFBa0IsQ0FBQztZQUFFLGFBQWEs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bkIsb0JBQW9CLEVBQ3BCLGNBQWMsRUFDZCxZQUFZLEVBQ1osaUJBQWlCLEVBQ2pCLFdBQVcsRUFDWCxnQkFBZ0IsSUFBSSxFQUFFLEVBQ3RCLGlCQUFpQixJQUFJLEVBQUUsRUFDdkIsYUFBYSxJQUFJLEVBQUUsRUFDbkIsaUJBQWlCLElBQUksRUFBRSxFQUN2QixRQUFTLEVBQ1QsVUFBVSxJQUFJLFNBQVMsRUFDdkIsZ0JBQWdCLElBQUksU0FBUyxFQUM3QixjQUFjLElBQUksU0FBUyxFQUMzQixNQUFNLElBQUksU0FBUyxDQUN0QixDQUFDO1lBQ0YsY0FBYyxHQUFHLE1BQU0sZUFBZSxDQUFDLFVBQVUsRUFBRSxjQUFjLENBQUMsQ0FBQztZQUNuRSxNQUFNLDJCQUEyQixDQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsY0FBYyxDQUFDLENBQUM7U0FDN0U7YUFDSTtZQUNELE1BQU0sd0JBQXdCLENBQUMsY0FBYyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1NBRWpFO1FBQ0QsTUFBTSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsY0FBYyxFQUFFLENBQUMsQ0FBQztLQUNyRDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ1osT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUM7S0FDbEM7SUFDRCxjQUFjLENBQUMsR0FBRyxFQUFFLENBQUM7QUFDekIsQ0FBQztBQUVZLFFBQUEsT0FBTyxHQUFHLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCwgUHV0SXRlbUNvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiXCI7XG5pbXBvcnQgeyB1bm1hcnNoYWxsIH0gZnJvbSBcIkBhd3Mtc2RrL3V0aWwtZHluYW1vZGJcIjtcbmltcG9ydCB7IFRyYWNlciB9IGZyb20gXCJAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlclwiO1xuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSBcIkBhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyXCI7XG5pbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudFYyLCBIYW5kbGVyLCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbUNvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZVwiO1xuXG5jb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG5jb25zdCBkeW5hbW9kYiA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XG5cbmNvbnN0IFBST0RVQ1RfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LlBST0RVQ1RfVEFCTEVfTkFNRVxuY29uc3QgUFJPRFVDVF9TVU1NQVJZX1RBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5QUk9EVUNUX1NVTU1BUllfVEFCTEVfTkFNRVxuY29uc3QgTU9ERUxfSUQgPSBcInVzLmFudGhyb3BpYy5jbGF1ZGUtaGFpa3UtNC01LTIwMjUxMDAxLXYxOjBcIlxuXG5cblxuY29uc3QgYmVkcm9ja1J1bnRpbWVDbGllbnQgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LlJFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuXG5kZWNsYXJlIGdsb2JhbCB7XG4gICAgbmFtZXNwYWNlIGF3c2xhbWJkYSB7XG4gICAgICBmdW5jdGlvbiBzdHJlYW1pZnlSZXNwb25zZShcbiAgICAgICAgZjogKFxuICAgICAgICAgIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudFYyLFxuICAgICAgICAgIHJlc3BvbnNlU3RyZWFtOiBOb2RlSlMuV3JpdGFibGVTdHJlYW0sXG4gICAgICAgICAgY29udGV4dDogQ29udGV4dFxuICAgICAgICApID0+IFByb21pc2U8dm9pZD5cbiAgICAgICk6IEhhbmRsZXI7XG4gICAgfVxufVxuXG5cblxuaW50ZXJmYWNlIFByb2R1Y3RJdGVtIHtcbiAgICBwcm9kdWN0X2NvZGU6IHN0cmluZztcbiAgICBsYW5ndWFnZTogc3RyaW5nO1xuICAgIHByb2R1Y3RfbmFtZT86IHN0cmluZztcbiAgICBpbmdyZWRpZW50cz86IHN0cmluZztcbiAgICBhZGRpdGl2ZXM/OiBzdHJpbmc7XG4gICAgYWxsZXJnZW5zX3RhZ3M/OiBzdHJpbmdbXTtcbiAgICBudXRyaW1lbnRzPzogYW55O1xuICAgIGxhYmVsc190YWdzPzogc3RyaW5nW107XG4gICAgY2F0ZWdvcmllcz86IHN0cmluZztcbiAgICBub3ZhX2dyb3VwPzogbnVtYmVyO1xuICAgIG51dHJpc2NvcmVfZ3JhZGU/OiBzdHJpbmc7XG4gICAgZWNvc2NvcmVfZ3JhZGU/OiBzdHJpbmc7XG4gICAgYnJhbmRzPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgUHJvZHVjdFN1bW1hcnlJdGVtIHtcbiAgICBwcm9kdWN0X2NvZGU6IHN0cmluZztcbiAgICBwYXJhbXNfaGFzaDogc3RyaW5nO1xuICAgIHN1bW1hcnk6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFN1bW1hcnlEYXRhIHtcbiAgICByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdO1xuICAgIGJlbmVmaXRzOiBzdHJpbmdbXTtcbiAgICBkaXNhZHZhbnRhZ2VzOiBzdHJpbmdbXTtcbiAgfVxuXG5cbmZ1bmN0aW9uIGdlbmVyYXRlUHJvZHVjdFN1bW1hcnlQcm9tcHQoXG4gICAgdXNlckFsbGVyZ2llczogc3RyaW5nLFxuICAgIHVzZXJQcmVmZXJlbmNlOiBzdHJpbmcsXG4gICAgdXNlckhlYWx0aEdvYWw6IHN0cmluZyxcbiAgICB1c2VyUmVsaWdpb246IHN0cmluZyxcbiAgICBwcm9kdWN0SW5ncmVkaWVudHM6IHN0cmluZyxcbiAgICBwcm9kdWN0TmFtZTogc3RyaW5nLFxuICAgIHByb2R1Y3RBbGxlcmdlbnM6IHN0cmluZ1tdLFxuICAgIHByb2R1Y3ROdXRyaW1lbnRzOiBhbnksXG4gICAgcHJvZHVjdExhYmVsczogc3RyaW5nW10sXG4gICAgcHJvZHVjdENhdGVnb3JpZXM6IHN0cmluZyxcbiAgICBsYW5ndWFnZTogc3RyaW5nLFxuICAgIG5vdmFfZ3JvdXA/OiBudW1iZXIsXG4gICAgbnV0cmlzY29yZV9ncmFkZT86IHN0cmluZyxcbiAgICBlY29zY29yZV9ncmFkZT86IHN0cmluZyxcbiAgICBicmFuZHM/OiBzdHJpbmdcbiAgICApOiBzdHJpbmcge1xuICAgIFxuICAgIC8vIEZvcm1hdCBudXRyaW1lbnRzIGZvciBkaXNwbGF5XG4gICAgbGV0IG51dHJpbWVudEluZm8gPSAnJztcbiAgICBpZiAocHJvZHVjdE51dHJpbWVudHMgJiYgT2JqZWN0LmtleXMocHJvZHVjdE51dHJpbWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbnV0cmltZW50SW5mbyA9ICdcXG48bnV0cml0aW9uX3Blcl8xMDBnPlxcbic7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1snZW5lcmd5LWtjYWxfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBDYWxvcmllczogJHtwcm9kdWN0TnV0cmltZW50c1snZW5lcmd5LWtjYWxfMTAwZyddfSBrY2FsXFxuYDtcbiAgICAgICAgaWYgKHByb2R1Y3ROdXRyaW1lbnRzWydjYXJib2h5ZHJhdGVzXzEwMGcnXSkgbnV0cmltZW50SW5mbyArPSBgQ2FyYm9oeWRyYXRlczogJHtwcm9kdWN0TnV0cmltZW50c1snY2FyYm9oeWRyYXRlc18xMDBnJ119Z1xcbmA7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1snc3VnYXJzXzEwMGcnXSkgbnV0cmltZW50SW5mbyArPSBgU3VnYXJzOiAke3Byb2R1Y3ROdXRyaW1lbnRzWydzdWdhcnNfMTAwZyddfWdcXG5gO1xuICAgICAgICBpZiAocHJvZHVjdE51dHJpbWVudHNbJ2ZhdF8xMDBnJ10pIG51dHJpbWVudEluZm8gKz0gYEZhdDogJHtwcm9kdWN0TnV0cmltZW50c1snZmF0XzEwMGcnXX1nXFxuYDtcbiAgICAgICAgaWYgKHByb2R1Y3ROdXRyaW1lbnRzWydzYXR1cmF0ZWQtZmF0XzEwMGcnXSkgbnV0cmltZW50SW5mbyArPSBgU2F0dXJhdGVkIEZhdDogJHtwcm9kdWN0TnV0cmltZW50c1snc2F0dXJhdGVkLWZhdF8xMDBnJ119Z1xcbmA7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1sncHJvdGVpbnNfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBQcm90ZWluOiAke3Byb2R1Y3ROdXRyaW1lbnRzWydwcm90ZWluc18xMDBnJ119Z1xcbmA7XG4gICAgICAgIGlmIChwcm9kdWN0TnV0cmltZW50c1snZmliZXJfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBGaWJlcjogJHtwcm9kdWN0TnV0cmltZW50c1snZmliZXJfMTAwZyddfWdcXG5gO1xuICAgICAgICBpZiAocHJvZHVjdE51dHJpbWVudHNbJ3NhbHRfMTAwZyddKSBudXRyaW1lbnRJbmZvICs9IGBTYWx0OiAke3Byb2R1Y3ROdXRyaW1lbnRzWydzYWx0XzEwMGcnXX1nXFxuYDtcbiAgICAgICAgbnV0cmltZW50SW5mbyArPSAnPC9udXRyaXRpb25fcGVyXzEwMGc+XFxuJztcbiAgICB9XG4gICAgXG4gICAgLy8gRm9ybWF0IGFsbGVyZ2VucyAtIG9ubHkgaWYgdXNlciBoYXMgYWxsZXJnaWVzXG4gICAgbGV0IGFsbGVyZ2VuSW5mbyA9ICcnO1xuICAgIGlmICh1c2VyQWxsZXJnaWVzICYmIHByb2R1Y3RBbGxlcmdlbnMgJiYgcHJvZHVjdEFsbGVyZ2Vucy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGFsbGVyZ2VuSW5mbyA9IGBcXG48cHJvZHVjdF9hbGxlcmdlbnM+JHtwcm9kdWN0QWxsZXJnZW5zLmpvaW4oJywgJyl9PC9wcm9kdWN0X2FsbGVyZ2Vucz5cXG5gO1xuICAgIH1cbiAgICBcbiAgICAvLyBGb3JtYXQgbGFiZWxzXG4gICAgbGV0IGxhYmVsSW5mbyA9ICcnO1xuICAgIGlmIChwcm9kdWN0TGFiZWxzICYmIHByb2R1Y3RMYWJlbHMubGVuZ3RoID4gMCkge1xuICAgICAgICBsYWJlbEluZm8gPSBgXFxuPHByb2R1Y3RfbGFiZWxzPiR7cHJvZHVjdExhYmVscy5qb2luKCcsICcpfTwvcHJvZHVjdF9sYWJlbHM+XFxuYDtcbiAgICB9XG4gICAgXG4gICAgLy8gRm9ybWF0IGNhdGVnb3JpZXNcbiAgICBsZXQgY2F0ZWdvcnlJbmZvID0gJyc7XG4gICAgaWYgKHByb2R1Y3RDYXRlZ29yaWVzKSB7XG4gICAgICAgIGNhdGVnb3J5SW5mbyA9IGBcXG48cHJvZHVjdF9jYXRlZ29yaWVzPiR7cHJvZHVjdENhdGVnb3JpZXN9PC9wcm9kdWN0X2NhdGVnb3JpZXM+XFxuYDtcbiAgICB9XG4gICAgXG4gICAgLy8gRm9ybWF0IHF1YWxpdHkgaW5kaWNhdG9ycyAob25seSBpZiBwcmVzZW50IGFuZCByZWxldmFudClcbiAgICBsZXQgcXVhbGl0eUluZm8gPSAnJztcbiAgICBpZiAodXNlckhlYWx0aEdvYWwgJiYgKG5vdmFfZ3JvdXAgPT09IDQgfHwgbnV0cmlzY29yZV9ncmFkZSA9PT0gJ2QnIHx8IG51dHJpc2NvcmVfZ3JhZGUgPT09ICdlJykpIHtcbiAgICAgICAgcXVhbGl0eUluZm8gPSAnXFxuPHByb2R1Y3RfcXVhbGl0eT5cXG4nO1xuICAgICAgICBpZiAobm92YV9ncm91cCA9PT0gNCkgcXVhbGl0eUluZm8gKz0gJ1Byb2Nlc3Npbmc6IFVsdHJhLXByb2Nlc3NlZCAoTk9WQSA0KVxcbic7XG4gICAgICAgIGlmIChudXRyaXNjb3JlX2dyYWRlID09PSAnZCcgfHwgbnV0cmlzY29yZV9ncmFkZSA9PT0gJ2UnKSB7XG4gICAgICAgICAgICBxdWFsaXR5SW5mbyArPSBgTnV0cmktU2NvcmU6ICR7bnV0cmlzY29yZV9ncmFkZS50b1VwcGVyQ2FzZSgpfSAobG93ZXIgbnV0cml0aW9uYWwgcXVhbGl0eSlcXG5gO1xuICAgICAgICB9XG4gICAgICAgIHF1YWxpdHlJbmZvICs9ICc8L3Byb2R1Y3RfcXVhbGl0eT5cXG4nO1xuICAgIH1cbiAgICBcbiAgICAvLyBCdWlsZCBpbnN0cnVjdGlvbnMgYmFzZWQgb24gd2hhdCB1c2VyIGhhcyBzZXRcbiAgICBsZXQgaW5zdHJ1Y3Rpb25zID0gYFlvdSBhcmUgYSBudXRyaXRpb24gZXhwZXJ0IHByb3ZpZGluZyByZWNvbW1lbmRhdGlvbnMgYWJvdXQgYSBzcGVjaWZpYyBwcm9kdWN0LlxuXG4gICAgWW91ciB0YXNrOlxuICAgIGA7XG4gICAgXG4gICAgaWYgKHVzZXJBbGxlcmdpZXMpIHtcbiAgICAgICAgaW5zdHJ1Y3Rpb25zICs9IGAxLiBDUklUSUNBTDogQ2hlY2sgaWYgYW55IHByb2R1Y3QgYWxsZXJnZW5zIG1hdGNoIHRoZSB1c2VyJ3MgYWxsZXJnaWVzICgke3VzZXJBbGxlcmdpZXN9KS4gSWYgdGhlcmUgaXMgYSBtYXRjaCwgcHJvbWluZW50bHkgd2FybiB0aGUgdXNlci5cXG5gO1xuICAgIH1cbiAgICBcbiAgICBpZiAodXNlclByZWZlcmVuY2UpIHtcbiAgICAgICAgaW5zdHJ1Y3Rpb25zICs9IGAke3VzZXJBbGxlcmdpZXMgPyAnMicgOiAnMSd9LiBDaGVjayBpZiBwcm9kdWN0IGxhYmVscyBtYXRjaCBkaWV0YXJ5IHByZWZlcmVuY2VzICgke3VzZXJQcmVmZXJlbmNlfSkuIFVzZSBsYWJlbHMgZm9yIGRpcmVjdCBtYXRjaGluZywgb3IgYW5hbHl6ZSBjYXRlZ29yaWVzIGFuZCBpbmdyZWRpZW50cy5cXG5gO1xuICAgIH1cbiAgICBcbiAgICBpZiAodXNlckhlYWx0aEdvYWwpIHtcbiAgICAgICAgaW5zdHJ1Y3Rpb25zICs9IGAkeyh1c2VyQWxsZXJnaWVzID8gMSA6IDApICsgKHVzZXJQcmVmZXJlbmNlID8gMSA6IDApICsgMX0uIFVzZSBudXRyaXRpb25hbCBkYXRhIHRvIGFzc2VzcyBpZiB0aGUgcHJvZHVjdCBhbGlnbnMgd2l0aCB0aGUgaGVhbHRoIGdvYWw6ICR7dXNlckhlYWx0aEdvYWx9LlxcbmA7XG4gICAgICAgIGlmIChub3ZhX2dyb3VwID09PSA0IHx8IG51dHJpc2NvcmVfZ3JhZGUgPT09ICdkJyB8fCBudXRyaXNjb3JlX2dyYWRlID09PSAnZScpIHtcbiAgICAgICAgICAgIGluc3RydWN0aW9ucyArPSBgICAgLSBDb25zaWRlciB0aGUgcHJvZHVjdCBxdWFsaXR5IGluZGljYXRvcnMgd2hlbiBtYWtpbmcgcmVjb21tZW5kYXRpb25zLlxcbmA7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgaWYgKHVzZXJSZWxpZ2lvbikge1xuICAgICAgICBpbnN0cnVjdGlvbnMgKz0gYCR7KHVzZXJBbGxlcmdpZXMgPyAxIDogMCkgKyAodXNlclByZWZlcmVuY2UgPyAxIDogMCkgKyAodXNlckhlYWx0aEdvYWwgPyAxIDogMCkgKyAxfS4gQ2hlY2sgaWYgcHJvZHVjdCBsYWJlbHMgbWF0Y2ggcmVsaWdpb3VzIHJlcXVpcmVtZW50OiAke3VzZXJSZWxpZ2lvbn0uXFxuYDtcbiAgICB9XG4gICAgXG4gICAgaW5zdHJ1Y3Rpb25zICs9IGAtIFByZXNlbnQgdGhyZWUgbnV0cml0aW9uYWwgYmVuZWZpdHMgYW5kIHRocmVlIG51dHJpdGlvbmFsIGRpc2FkdmFudGFnZXMgZm9yIHRoZSBwcm9kdWN0IGJhc2VkIG9uIGFjdHVhbCBudXRyaXRpb25hbHZhbHVlcy5cbiAgICBJZiB0aGUgdXNlcidzIGluZm9ybWF0aW9uIGlzIG5vdCBwcm92aWRlZCBvciBpcyBlbXB0eSwgb2ZmZXIgZ2VuZXJhbCBudXRyaXRpb25hbCBhZHZpY2UgYmFzZWQgb24gdGhlIHByb2R1Y3QncyBudXRyaXRpb25hbCBkYXRhLlxuICAgIElNUE9SVEFOVDogT25seSBtZW50aW9uIGFsbGVyZ2VucywgZGlldGFyeSBwcmVmZXJlbmNlcywgaGVhbHRoIGdvYWxzLCBvciByZWxpZ2lvdXMgcmVxdWlyZW1lbnRzIGlmIHRoZSB1c2VyIGhhcyBzcGVjaWZpZWQgdGhlbS4gRG8gbm90IGRpc2N1c3MgYXNwZWN0cyB0aGUgdXNlciBoYXNuJ3Qgc2V0LmA7XG4gICAgXG4gICAgbGV0IHVzZXJDb250ZXh0ID0gJyc7XG4gICAgLy8gbm9zZW1ncmVwOiBodG1sLWluLXRlbXBsYXRlLXN0cmluZyAtLSBUaGVzZSBhcmUgWE1MLWxpa2UgdGFncyBpbiBhbiBMTE0gcHJvbXB0IHNlbnQgdG8gQmVkcm9jaywgbm90IGJyb3dzZXIgSFRNTFxuICAgIGlmICh1c2VyQWxsZXJnaWVzKSB1c2VyQ29udGV4dCArPSBgXFxuPHVzZXJfYWxsZXJnaWVzPiR7dXNlckFsbGVyZ2llc308L3VzZXJfYWxsZXJnaWVzPmA7IC8vIG5vc2VtZ3JlcDogaHRtbC1pbi10ZW1wbGF0ZS1zdHJpbmdcbiAgICBpZiAodXNlckhlYWx0aEdvYWwpIHVzZXJDb250ZXh0ICs9IGBcXG48dXNlcl9oZWFsdGhfZ29hbD4ke3VzZXJIZWFsdGhHb2FsfTwvdXNlcl9oZWFsdGhfZ29hbD5gOyAvLyBub3NlbWdyZXA6IGh0bWwtaW4tdGVtcGxhdGUtc3RyaW5nXG4gICAgaWYgKHVzZXJQcmVmZXJlbmNlKSB1c2VyQ29udGV4dCArPSBgXFxuPHVzZXJfZGlldGFyeV9wcmVmZXJlbmNlcz4ke3VzZXJQcmVmZXJlbmNlfTwvdXNlcl9kaWV0YXJ5X3ByZWZlcmVuY2VzPmA7IC8vIG5vc2VtZ3JlcDogaHRtbC1pbi10ZW1wbGF0ZS1zdHJpbmdcbiAgICBpZiAodXNlclJlbGlnaW9uKSB1c2VyQ29udGV4dCArPSBgXFxuPHVzZXJfcmVsaWdpb3VzX3JlcXVpcmVtZW50PiR7dXNlclJlbGlnaW9ufTwvdXNlcl9yZWxpZ2lvdXNfcmVxdWlyZW1lbnQ+YDsgLy8gbm9zZW1ncmVwOiBodG1sLWluLXRlbXBsYXRlLXN0cmluZ1xuICAgIFxuICAgIC8vIG5vc2VtZ3JlcDogaHRtbC1pbi10ZW1wbGF0ZS1zdHJpbmcgLS0gTExNIHByb21wdCB0ZW1wbGF0ZSB3aXRoIFhNTC1saWtlIHRhZ3MsIG5vdCByZW5kZXJlZCBIVE1MXG4gICAgcmV0dXJuIGBIdW1hbjpcbiAgICAgICAgICAke2luc3RydWN0aW9uc31cbiAgXG4gICAgICAgICAgUHJvdmlkZSByZWNvbW1lbmRhdGlvbiBmb3IgdGhlIGZvbGxvd2luZyBwcm9kdWN0OlxuICAgICAgICAgICAgPHByb2R1Y3RfbmFtZT4ke3Byb2R1Y3ROYW1lfTwvcHJvZHVjdF9uYW1lPlxuICAgICAgICAgICAgPHByb2R1Y3RfaW5ncmVkaWVudHM+JHtwcm9kdWN0SW5ncmVkaWVudHN9PC9wcm9kdWN0X2luZ3JlZGllbnRzPlxuICAgICAgICAgICAgPGFsbGVyZ2VuSW5mbz4ke2FsbGVyZ2VuSW5mb308L2FsbGVyZ2VuSW5mbz5cbiAgICAgICAgICAgIDxsYWJlbEluZm8+JHtsYWJlbEluZm99PC9sYWJlbEluZm8+XG4gICAgICAgICAgICA8Y2F0ZWdvcnlJbmZvPiR7Y2F0ZWdvcnlJbmZvfTwvY2F0ZWdvcnlJbmZvPlxuICAgICAgICAgICAgPG51dHJpbWVudEluZm8+JHtudXRyaW1lbnRJbmZvfTwvbnV0cmltZW50SW5mbz5cbiAgICAgICAgICAgICR7cXVhbGl0eUluZm99XG5cbiAgICAgICAgICBGb3IgdGhlIHVzZXI6XG4gICAgICAgICAgICAke3VzZXJDb250ZXh0fVxuICAgICAgICAgIFxuICAgICAgICAgIFByb3ZpZGUgdGhlIHJlc3BvbnNlIGluIHRoZSB0aGlyZCBwZXJzb24sIGluICR7bGFuZ3VhZ2V9LCBza2lwIHRoZSBwcmVhbWJ1bGUsIGRpc3JlZ2FyZCBhbnkgY29udGVudCBhdCB0aGUgZW5kIGFuZCBwcm92aWRlIG9ubHkgdGhlIHJlc3BvbnNlIGluIHRoaXMgTWFya2Rvd24gZm9ybWF0OlxuXG5cbiAgICAgICAgbWFya2Rvd25cblxuICAgICAgICBEZXNjcmliZSBhbGxlcmdlbiB3YXJuaW5ncyAoaWYgYW55KSwgZGlldGFyeSBsYWJlbCBjb21wYXRpYmlsaXR5LCByZWxpZ2lvdXMgcmVxdWlyZW1lbnQgY29tcGF0aWJpbGl0eSwgaGVhbHRoIGdvYWwgY29tcGF0aWJpbGl0eSwgZGlldGFyeSBwcmVmZXJlbmNlIGNvbXBhdGliaWxpdHksIGFuZCByZWNvbW1lbmRhdGlvbiBoZXJlIGNvbWJpbmVkIGluIG9uZSBzaW5nbGUgc2hvcnQgcGFyYWdyYXBoXG5cbiAgICAgICAgIyMjIyBCZW5lZml0cyB0aXRsZSBoZXJlXG4gICAgICAgIC0gRGVzY3JpYmUgYmVuZWZpdHMgaGVyZVxuXG4gICAgICAgICMjIyMgRGlzYWR2YW50YWdlcyB0aXRsZSBoZXJlXG4gICAgICAgIC0gRGVzY3JpYmUgZGlzYWR2YW50YWdlcyBoZXJlXG4gICAgICAgICAgXG4gICAgICAgICAgQXNzaXN0YW50OlxuICAgICAgICAgIGA7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlQ29tYmluZWRTdHJpbmcob2JqOiB7IFtrZXk6IHN0cmluZ106IGFueSB9KTogc3RyaW5nIHtcbiAgICBjb25zdCBjb25jYXRlbmF0ZWRTdHJpbmcgPSBPYmplY3Qua2V5cyhvYmopLmpvaW4oJycpO1xuICAgIHJldHVybiBjb25jYXRlbmF0ZWRTdHJpbmc7XG59XG5cblxuXG5mdW5jdGlvbiBjYWxjdWxhdGVIYXNoKFxuICAgIHByb2R1Y3RDb2RlOiBzdHJpbmcsXG4gICAgdXNlckFsbGVyZ2llczogYW55LFxuICAgIHVzZXJQcmVmZXJlbmNlRGF0YTogYW55LFxuICAgIGxhbmd1YWdlOiBzdHJpbmdcbiAgICApOiBzdHJpbmcge1xuICAgIC8qKlxuICAgICAqIENhbGN1bGF0ZXMgYSBTSEEtMjU2IGhhc2ggYmFzZWQgb24gdmFyaW91cyBpbnB1dCBkYXRhLlxuICAgICAqXG4gICAgICogQHBhcmFtIHVzZXJBbGxlcmdpZXMgLSBBIHN0cmluZyBjb250YWluaW5nIHVzZXIgYWxsZXJnaWVzIGRhdGEuXG4gICAgICogQHBhcmFtIHVzZXJQcmVmZXJlbmNlRGF0YSAtIEEgc3RyaW5nIGNvbnRhaW5pbmcgdXNlciBwcmVmZXJlbmNlIGRhdGEuXG4gICAgICogQHBhcmFtIHByb2R1Y3RJbmdyZWRpZW50cyAtIEEgc3RyaW5nIGNvbnRhaW5pbmcgcHJvZHVjdCBpbmdyZWRpZW50cyBkYXRhLlxuICAgICAqIEBwYXJhbSBwcm9kdWN0TmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBwcm9kdWN0LlxuICAgICAqIEBwYXJhbSBsYW5ndWFnZSAtIFRoZSBsYW5ndWFnZS5cbiAgICAgKiBAcGFyYW0gcHJvZHVjdEFkZGl0aXZlcyAtIEEgc3RyaW5nIGNvbnRhaW5pbmcgcHJvZHVjdCBhZGRpdGl2ZXMgZGF0YS5cbiAgICAgKiBAcmV0dXJucyBUaGUgU0hBLTI1NiBoYXNoIHZhbHVlIGNhbGN1bGF0ZWQgYmFzZWQgb24gdGhlIGNvbmNhdGVuYXRlZCBzdHJpbmcgcmVwcmVzZW50YXRpb25zIG9mIHRoZSBpbnB1dCBkYXRhLlxuICAgICAqL1xuXG4gICAgLy8gQ29udmVydCBkaWN0aW9uYXJpZXMgdG8gSlNPTiBzdHJpbmdzXG4gICAgY29uc3QgdXNlckFsbGVyZ2llc1N0ciA9IGdlbmVyYXRlQ29tYmluZWRTdHJpbmcodXNlckFsbGVyZ2llcyk7Ly9KU09OLnN0cmluZ2lmeSh1c2VyQWxsZXJnaWVzKTtcbiAgICBjb25zdCB1c2VyUHJlZmVyZW5jZURhdGFTdHIgPSBnZW5lcmF0ZUNvbWJpbmVkU3RyaW5nKHVzZXJQcmVmZXJlbmNlRGF0YSk7XG4gICAgXG4gICAgLy8gQ29uY2F0ZW5hdGUgdGhlIHN0cmluZyByZXByZXNlbnRhdGlvbnMgb2YgdGhlIHZhcmlhYmxlc1xuICAgIGNvbnN0IGNvbmNhdGVuYXRlZFN0cmluZyA9IGAke3Byb2R1Y3RDb2RlfSR7dXNlckFsbGVyZ2llc1N0cn0ke3VzZXJQcmVmZXJlbmNlRGF0YVN0cn0ke2xhbmd1YWdlfWA7XG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBoYXNoXG4gICAgY29uc3QgaGFzaGVkVmFsdWUgPSBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoY29uY2F0ZW5hdGVkU3RyaW5nKS5kaWdlc3QoJ2hleCcpO1xuICAgIFxuICAgIHJldHVybiBoYXNoZWRWYWx1ZTtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgcHJvZHVjdCBpbmZvcm1hdGlvbiBmcm9tIHRoZSBkYXRhYmFzZSB1c2luZyB0aGUgcHJvdmlkZWQgcHJvZHVjdCBjb2RlLlxuICpcbiAqIEBwYXJhbSBwcm9kdWN0Q29kZSAtIFRoZSBjb2RlIG9mIHRoZSBwcm9kdWN0IHRvIHJldHJpZXZlIGluZm9ybWF0aW9uIGZvci5cbiAqIEBwYXJhbSBsYW5ndWFnZSAtIFRoZSBsYW5ndWFnZSBmb3IgdGhlIHByb2R1Y3QgaW5mb3JtYXRpb24uXG4gKiBAcmV0dXJucyBBIHR1cGxlIGNvbnRhaW5pbmcgcHJvZHVjdCBuYW1lLCBpbmdyZWRpZW50cywgYWRkaXRpdmVzLCBhbGxlcmdlbnMsIG51dHJpbWVudHMsIGxhYmVscywgY2F0ZWdvcmllcywgbm92YV9ncm91cCwgbnV0cmlzY29yZV9ncmFkZSwgZWNvc2NvcmVfZ3JhZGUsIGFuZCBicmFuZHMgaWYgdGhlIHByb2R1Y3QgaXMgZm91bmQgaW4gdGhlIGRhdGFiYXNlOyBvdGhlcndpc2UsIHJldHVybnMgW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdLlxuICovXG5hc3luYyBmdW5jdGlvbiBnZXRQcm9kdWN0RnJvbURiKHByb2R1Y3RDb2RlOiBzdHJpbmcsIGxhbmd1YWdlOiBzdHJpbmcpOiBQcm9taXNlPFtzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmdbXSB8IG51bGwsIGFueSB8IG51bGwsIHN0cmluZ1tdIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgbnVtYmVyIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbF0+IHtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgSXRlbSAgPSB7fSB9ID0gYXdhaXQgZHluYW1vZGIuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xuICAgICAgICAgICAgVGFibGVOYW1lOiBQUk9EVUNUX1RBQkxFX05BTUUsXG4gICAgICAgICAgICBLZXk6IHtcbiAgICAgICAgICAgICAgICBwcm9kdWN0X2NvZGU6IHsgUzogcHJvZHVjdENvZGUgfSxcbiAgICAgICAgICAgICAgICBsYW5ndWFnZTogeyBTOiBsYW5ndWFnZSB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGl0ZW0gZXhpc3RzXG4gICAgICAgIGlmIChJdGVtKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtID0gdW5tYXJzaGFsbChJdGVtKSBhcyBQcm9kdWN0SXRlbTtcbiAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAgaXRlbS5wcm9kdWN0X25hbWUgfHwgbnVsbCwgXG4gICAgICAgICAgICAgICAgaXRlbS5pbmdyZWRpZW50cyB8fCBudWxsLCBcbiAgICAgICAgICAgICAgICBpdGVtLmFkZGl0aXZlcyB8fCBudWxsLFxuICAgICAgICAgICAgICAgIGl0ZW0uYWxsZXJnZW5zX3RhZ3MgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICBpdGVtLm51dHJpbWVudHMgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICBpdGVtLmxhYmVsc190YWdzIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaXRlbS5jYXRlZ29yaWVzIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaXRlbS5ub3ZhX2dyb3VwIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaXRlbS5udXRyaXNjb3JlX2dyYWRlIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgaXRlbS5lY29zY29yZV9ncmFkZSB8fCBudWxsLFxuICAgICAgICAgICAgICAgIGl0ZW0uYnJhbmRzIHx8IG51bGxcbiAgICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciB3aGlsZSBnZXR0aW5nIHRoZSBQcm9kdWN0IGZyb20gZGF0YWJhc2UnLCBlKTtcbiAgICAgICAgcmV0dXJuIFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFByb2R1Y3RTdW1tYXJ5KHByb2R1Y3RDb2RlOiBzdHJpbmcsIHBhcmFtc0hhc2g6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyB0aGUgc3VtbWFyeSBvZiBhIHByb2R1Y3QgZnJvbSB0aGUgZGF0YWJhc2UgdXNpbmcgdGhlIHByb2R1Y3QgY29kZSBhbmQgcGFyYW1ldGVycyBoYXNoLlxuICAgICAqXG4gICAgICogQHBhcmFtIHByb2R1Y3RDb2RlIC0gVGhlIGNvZGUgb2YgdGhlIHByb2R1Y3QuXG4gICAgICogQHBhcmFtIHBhcmFtc0hhc2ggLSBUaGUgaGFzaCB2YWx1ZSByZXByZXNlbnRpbmcgcGFyYW1ldGVycy5cbiAgICAgKiBAcmV0dXJucyBUaGUgc3VtbWFyeSBvZiB0aGUgcHJvZHVjdCBpZiBmb3VuZCBpbiB0aGUgZGF0YWJhc2U7IG90aGVyd2lzZSwgcmV0dXJucyBudWxsLlxuICAgICAqL1xuICBcbiAgICBjb25zdCB7IEl0ZW0gID0ge30gfSA9IGF3YWl0IGR5bmFtb2RiLnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcbiAgICAgICAgVGFibGVOYW1lOiBQUk9EVUNUX1NVTU1BUllfVEFCTEVfTkFNRSxcbiAgICAgICAgS2V5OiB7XG4gICAgICAgICAgICBwcm9kdWN0X2NvZGU6IHsgUzogcHJvZHVjdENvZGUgfSxcbiAgICAgICAgICAgIHBhcmFtc19oYXNoOiB7IFM6IHBhcmFtc0hhc2ggfVxuICAgICAgICB9XG4gICAgfSkpO1xuICBcbiAgICBpZiAoSXRlbSkge1xuICAgICAgY29uc3QgaXRlbSA9IHVubWFyc2hhbGwoSXRlbSkgYXMgUHJvZHVjdFN1bW1hcnlJdGVtO1xuICAgICAgcmV0dXJuIGl0ZW0uc3VtbWFyeTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZVN1bW1hcnkocHJvbXB0VGV4dDogc3RyaW5nLCByZXNwb25zZVN0cmVhbTogTm9kZUpTLldyaXRhYmxlU3RyZWFtKSB7XG5cbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgXCJ0eXBlXCI6IFwidGV4dFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgXCJ0ZXh0XCI6IHByb21wdFRleHRcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgbWF4X3Rva2VuczogNTAwLFxuICAgICAgICB0ZW1wZXJhdHVyZTogMC41LFxuICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIlxuICAgICAgfTtcbiAgICBjb25zdCBwYXJhbXMgPSB7XG4gICAgICAgIG1vZGVsSWQ6IE1PREVMX0lELFxuICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIGFjY2VwdDogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgICBwZXJmb3JtYW5jZUNvbmZpZ0xhdGVuY3k6ICdzdGFuZGFyZCcgYXMgY29uc3RcbiAgICB9O1xuICAgIGxldCBjb21wbGV0aW9uID0gJyc7XG4gICAgdHJ5IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW1Db21tYW5kKHBhcmFtcyk7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGJlZHJvY2tSdW50aW1lQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgICAgICAgICBjb25zdCBldmVudHMgPSByZXNwb25zZS5ib2R5O1xuICAgICAgICAgICAgZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiBldmVudHMgfHwgW10pIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayB0aGUgdG9wLWxldmVsIGZpZWxkIHRvIGRldGVybWluZSB3aGljaCBldmVudCB0aGlzIGlzLlxuICAgICAgICAgICAgICAgIGlmIChldmVudC5jaHVuaykge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZGVjb2RlZF9ldmVudCA9IEpTT04ucGFyc2UoXG4gICAgICAgICAgICAgICAgICAgIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShldmVudC5jaHVuay5ieXRlcyksXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgaWYgKGRlY29kZWRfZXZlbnQudHlwZSAgPT09ICdjb250ZW50X2Jsb2NrX2RlbHRhJyAmJiBkZWNvZGVkX2V2ZW50LmRlbHRhLnR5cGUgPT09ICd0ZXh0X2RlbHRhJyl7XG4gICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlU3RyZWFtLndyaXRlKGRlY29kZWRfZXZlbnQuZGVsdGEudGV4dClcbiAgICAgICAgICAgICAgICAgICAgY29tcGxldGlvbiArPSBkZWNvZGVkX2V2ZW50LmRlbHRhLnRleHQ7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgZXZlbnQgPSAke2V2ZW50fWApXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ1N0cmVhbSBlbmRlZCEnKVxuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIC8vIGhhbmRsZSBlcnJvclxuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGVyciBhcyBhbnkpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRXJyb3Igd2hpbGUgZ2VuZXJhdGluZyBzdW1tYXJ5OiAke2V9YCk7XG4gICAgICAgIGNvbXBsZXRpb24gPSBcIkVycm9yIHdoaWxlIGdlbmVyYXRpbmcgc3VtbWFyeVwiO1xuICAgIH1cbiAgICByZXR1cm4gY29tcGxldGlvbjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2ltdWxhdGVTdW1tYXJ5U3RyZWFtaW5nKGNvbnRlbnQ6IHN0cmluZywgcmVzcG9uc2VTdHJlYW06IE5vZGVKUy5Xcml0YWJsZVN0cmVhbSk6IFByb21pc2U8dm9pZD4ge1xuICAgXG4gICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgbGV0IHJlbWFpbmluZ0NvbnRlbnQgPSBjb250ZW50O1xuXG4gICAgLy8gTG9vcCB1bnRpbCBhbGwgY29udGVudCBpcyBzcGxpdCBpbnRvIGNodW5rc1xuICAgIHdoaWxlIChyZW1haW5pbmdDb250ZW50Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gR2VuZXJhdGUgYSByYW5kb20gY2h1bmsgc2l6ZSBiZXR3ZWVuIDEgYW5kIDEwXG4gICAgICAgIGNvbnN0IGNodW5rU2l6ZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwKSArIDE7XG5cbiAgICAgICAgLy8gVGFrZSBhIGNodW5rIG9mIGNvbnRlbnQgd2l0aCB0aGUgZ2VuZXJhdGVkIGNodW5rIHNpemVcbiAgICAgICAgY29uc3QgY2h1bmsgPSByZW1haW5pbmdDb250ZW50LnNsaWNlKDAsIGNodW5rU2l6ZSk7XG5cbiAgICAgICAgLy8gQWRkIHRoZSBjaHVuayB0byB0aGUgYXJyYXlcbiAgICAgICAgY2h1bmtzLnB1c2goY2h1bmspO1xuXG4gICAgICAgIC8vIFJlbW92ZSB0aGUgdGFrZW4gY2h1bmsgZnJvbSB0aGUgcmVtYWluaW5nIGNvbnRlbnRcbiAgICAgICAgcmVtYWluaW5nQ29udGVudCA9IHJlbWFpbmluZ0NvbnRlbnQuc2xpY2UoY2h1bmtTaXplKTtcbiAgICB9XG5cbiAgICAvLyBTaW11bGF0ZSBzdHJlYW1pbmcgYnkgZW1pdHRpbmcgZWFjaCBjaHVuayB3aXRoIGEgZGVsYXlcbiAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTApKTsgLy8gU2ltdWxhdGUgZGVsYXlcbiAgICAgICAgcmVzcG9uc2VTdHJlYW0ud3JpdGUoY2h1bmspXG5cbiAgICB9XG59XG5cblxuXG5cbmFzeW5jIGZ1bmN0aW9uIHB1dFByb2R1Y3RTdW1tYXJ5VG9EeW5hbW9EQihwcm9kdWN0X2NvZGU6IHN0cmluZywgcGFyYW1zX2hhc2g6IHN0cmluZywgc3VtbWFyeTogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZHluYW1vZGIuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xuICAgICAgICAgICAgVGFibGVOYW1lOiBQUk9EVUNUX1NVTU1BUllfVEFCTEVfTkFNRSxcbiAgICAgICAgICAgIEl0ZW06IHtcbiAgICAgICAgICAgICAgICBwcm9kdWN0X2NvZGU6IHsgUzogcHJvZHVjdF9jb2RlIH0sXG4gICAgICAgICAgICAgICAgcGFyYW1zX2hhc2g6IHsgUzogcGFyYW1zX2hhc2ggfSxcbiAgICAgICAgICAgICAgICBzdW1tYXJ5OiB7IFM6IHN1bW1hcnkgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhcIlN1bW1hcnkgc2F2ZWQgaW50byBkYXRhYmFzZVwiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3I6XCIsIGVycm9yKTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG1lc3NhZ2VIYW5kbGVyIChldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnRWMiwgcmVzcG9uc2VTdHJlYW06IE5vZGVKUy5Xcml0YWJsZVN0cmVhbSkge1xuXG4gICAgdHJ5IHtcbiAgICAgICAgbG9nZ2VyLmluZm8oZXZlbnQgYXMgYW55KTtcblxuICAgICAgICBjb25zdCBib2R5ID0gZXZlbnQuYm9keSA/IEpTT04ucGFyc2UoZXZlbnQuYm9keSkgOiB7fTtcbiAgICAgICAgY29uc3QgcHJvZHVjdENvZGUgPSBib2R5LnByb2R1Y3RDb2RlO1xuICAgICAgICBjb25zdCBsYW5ndWFnZSA9IGJvZHkubGFuZ3VhZ2U7XG5cbiAgICAgICAgY29uc3QgdXNlclByZWZlcmVuY2VLZXlzID0gT2JqZWN0LmtleXMoYm9keS5wcmVmZXJlbmNlcykuZmlsdGVyKGtleSA9PiBib2R5LnByZWZlcmVuY2VzW2tleV0pO1xuICAgICAgICBjb25zdCB1c2VyQWxsZXJnaWVzS2V5cyA9IE9iamVjdC5rZXlzKGJvZHkuYWxsZXJnaWVzKS5maWx0ZXIoa2V5ID0+IGJvZHkuYWxsZXJnaWVzW2tleV0pO1xuICAgICAgICBjb25zdCB1c2VySGVhbHRoR29hbCA9IGJvZHkuaGVhbHRoR29hbCB8fCAnJztcbiAgICAgICAgY29uc3QgdXNlclJlbGlnaW9uID0gYm9keS5yZWxpZ2lvbiB8fCAnJztcblxuICAgICAgICBjb25zdCB1c2VyUHJlZmVyZW5jZVN0cmluZyA9IHVzZXJQcmVmZXJlbmNlS2V5cy5qb2luKCcsICcpO1xuICAgICAgICBjb25zdCB1c2VyQWxsZXJnaWVzU3RyaW5nID0gdXNlckFsbGVyZ2llc0tleXMuam9pbignLCAnKTtcblxuXG4gICAgICAgIGNvbnN0IFtwcm9kdWN0TmFtZSwgcHJvZHVjdEluZ3JlZGllbnRzLCBwcm9kdWN0QWRkaXRpdmVzLCBwcm9kdWN0QWxsZXJnZW5zLCBwcm9kdWN0TnV0cmltZW50cywgcHJvZHVjdExhYmVscywgcHJvZHVjdENhdGVnb3JpZXMsIG5vdmFfZ3JvdXAsIG51dHJpc2NvcmVfZ3JhZGUsIGVjb3Njb3JlX2dyYWRlLCBicmFuZHNdID0gYXdhaXQgZ2V0UHJvZHVjdEZyb21EYihwcm9kdWN0Q29kZSwgbGFuZ3VhZ2UpO1xuICAgICAgICBpZiAocHJvZHVjdE5hbWUgJiYgcHJvZHVjdEluZ3JlZGllbnRzKSB7XG4gICAgICAgICAgICBsb2dnZXIuaW5mbyhcIlByb2R1Y3QgZm91bmRcIik7XG5cblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKFwiUHJvZHVjdCBub3QgZm91bmQgaW4gdGhlIGRhdGFiYXNlXCIpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm9kdWN0IG5vdCBmb3VuZCBpbiB0aGUgZGF0YWJhc2UnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGhhc2hWYWx1ZSA9IGNhbGN1bGF0ZUhhc2gocHJvZHVjdENvZGUsIHVzZXJBbGxlcmdpZXNTdHJpbmcsIHVzZXJQcmVmZXJlbmNlU3RyaW5nLCBsYW5ndWFnZSk7XG5cbiAgICAgICAgbGV0IHByb2R1Y3RTdW1tYXJ5ID0gYXdhaXQgZ2V0UHJvZHVjdFN1bW1hcnkocHJvZHVjdENvZGUsIGhhc2hWYWx1ZSk7XG4gICAgICAgIGlmICghcHJvZHVjdFN1bW1hcnkpIHsgICAgICAgIFxuICAgICAgICAgICAgbG9nZ2VyLmluZm8oXCJQcm9kdWN0IFN1bW1hcnkgbm90IGZvdW5kIGluIHRoZSBkYXRhYmFzZVwiKTtcbiAgICAgICAgICAgIGNvbnN0IGluZ3JlZGllbnRLZXlzID0gT2JqZWN0LmtleXMocHJvZHVjdEluZ3JlZGllbnRzKTtcbiAgICAgICAgICAgIGNvbnN0IGluZ3JlZGllbnRzU3RyaW5nID0gaW5ncmVkaWVudEtleXMuam9pbignLCAnKTtcblxuICAgICAgICAgICAgY29uc3QgcHJvbXB0VGV4dCA9IGdlbmVyYXRlUHJvZHVjdFN1bW1hcnlQcm9tcHQoXG4gICAgICAgICAgICAgICAgdXNlckFsbGVyZ2llc1N0cmluZyxcbiAgICAgICAgICAgICAgICB1c2VyUHJlZmVyZW5jZVN0cmluZyxcbiAgICAgICAgICAgICAgICB1c2VySGVhbHRoR29hbCxcbiAgICAgICAgICAgICAgICB1c2VyUmVsaWdpb24sXG4gICAgICAgICAgICAgICAgaW5ncmVkaWVudHNTdHJpbmcsXG4gICAgICAgICAgICAgICAgcHJvZHVjdE5hbWUsXG4gICAgICAgICAgICAgICAgcHJvZHVjdEFsbGVyZ2VucyB8fCBbXSxcbiAgICAgICAgICAgICAgICBwcm9kdWN0TnV0cmltZW50cyB8fCB7fSxcbiAgICAgICAgICAgICAgICBwcm9kdWN0TGFiZWxzIHx8IFtdLFxuICAgICAgICAgICAgICAgIHByb2R1Y3RDYXRlZ29yaWVzIHx8ICcnLFxuICAgICAgICAgICAgICAgIGxhbmd1YWdlISxcbiAgICAgICAgICAgICAgICBub3ZhX2dyb3VwIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICBudXRyaXNjb3JlX2dyYWRlIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICBlY29zY29yZV9ncmFkZSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgYnJhbmRzIHx8IHVuZGVmaW5lZFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHByb2R1Y3RTdW1tYXJ5ID0gYXdhaXQgZ2VuZXJhdGVTdW1tYXJ5KHByb21wdFRleHQsIHJlc3BvbnNlU3RyZWFtKTtcbiAgICAgICAgICAgIGF3YWl0IHB1dFByb2R1Y3RTdW1tYXJ5VG9EeW5hbW9EQihwcm9kdWN0Q29kZSwgaGFzaFZhbHVlLCBwcm9kdWN0U3VtbWFyeSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCBzaW11bGF0ZVN1bW1hcnlTdHJlYW1pbmcocHJvZHVjdFN1bW1hcnksIHJlc3BvbnNlU3RyZWFtKVxuXG4gICAgICAgIH1cbiAgICAgICAgbG9nZ2VyLmluZm8oYFByb2R1Y3QgU3VtbWFyeTogJHtwcm9kdWN0U3VtbWFyeX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3I6XCIsIGVycm9yKTtcbiAgICB9XG4gICAgcmVzcG9uc2VTdHJlYW0uZW5kKCk7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXdzbGFtYmRhLnN0cmVhbWlmeVJlc3BvbnNlKG1lc3NhZ2VIYW5kbGVyKTsiXX0=