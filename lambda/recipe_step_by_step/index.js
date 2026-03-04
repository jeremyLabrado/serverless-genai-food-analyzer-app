"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const tracer_1 = require("@aws-lambda-powertools/tracer");
const logger_1 = require("@aws-lambda-powertools/logger");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const tracer = new tracer_1.Tracer();
const logger = new logger_1.Logger();
const bedrockRuntimeClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.REGION || 'us-east-1' });
async function generateRecipeSteps(language, recipe, responseStream) {
    const systemPrompt = "Your task is to generate personalized recipe ideas based on the user's input of available ingredients and dietary preferences. Use this information to suggest a variety of creative and delicious recipes that can be made using the given ingredients while accommodating the user's dietary needs, if any are mentioned. For each recipe, provide a brief description, a list of required ingredients, and a simple set of instructions. Ensure that the recipes are easy to follow, nutritious, and can be prepared with minimal additional ingredients or equipment.";
    const promptText = `
    Recipee title:${recipe.title}
    Recipee description:${recipe.description}
    Available ingredients:${recipe.ingredients} ${recipe.optional_ingredients}
    
    Answer must be in the following markdown format:
    ### Step 1: [Step Title]
    - Action 1: [Action description] 
    - Action 2: [Action description]

    **Ingredients:** [Ingredient 1], [Ingredient 2], [Ingredient 3]

    ### Step 2: [Step Title]
    - Action 1: [Action description]
    - Action 2: [Action description]

    **Ingredients:** [Ingredient 1], [Ingredient 2]

    ### Step 3: [Step Title]
    - Action 1: [Action description]
    - Action 2: [Action description]

    **Ingredients:** [Ingredient 1], [Ingredient 2], [Ingredient 3], [Ingredient 4]

    Describe the actions in each step with detailed but concise descriptions, including ingredients needed, quantities, time, and any appliances required. Ensure your tone is engaging and friendly.
    
    Only use ingredients present in the provided recipe.

    Response must be in ${language}.

    Think step by step and elaborate your thoughts inside <thinking></thinking> then answer in a markdown format`;
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
        max_tokens: 1000,
        system: systemPrompt,
        temperature: 0.5,
        stop_sequences: ['</answer>'],
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
            let accumulating = true;
            let accumulatedChunks = '';
            const command = new client_bedrock_runtime_1.InvokeModelWithResponseStreamCommand(params);
            const response = await bedrockRuntimeClient.send(command);
            const events = response.body;
            for await (const event of events || []) {
                // Check the top-level field to determine which event this is.
                if (event.chunk) {
                    const decoded_event = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
                    if (decoded_event.type === 'content_block_delta' && decoded_event.delta.type === 'text_delta') {
                        const text = decoded_event.delta.text;
                        //responseStream.write(decoded_event.delta.text)
                        //accumulatedChunks += text;
                        logger.info(decoded_event.delta.text);
                        completion += decoded_event.delta.text;
                        if (accumulating) {
                            accumulatedChunks += text;
                            if (accumulatedChunks.includes('</thinking>')) {
                                accumulating = false;
                                const startIndex = accumulatedChunks.indexOf("</thinking>") + "</thinking>".length;
                                const remainingText = accumulatedChunks.substring(startIndex);
                                logger.info(remainingText);
                                responseStream.write(remainingText);
                            }
                        }
                        else {
                            responseStream.write(text);
                        }
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
async function messageHandler(event, responseStream) {
    try {
        logger.info(event);
        const body = event.body ? JSON.parse(event.body) : {};
        const language = body.language;
        const recipe = body.recipe;
        const recipeSteps = await generateRecipeSteps(language, recipe, responseStream);
        //await putProductSummaryToDynamoDB(productCode, hashValue, productSummary);
    }
    catch (error) {
        console.error("Error:", error);
    }
    responseStream.end();
}
exports.handler = awslambda.streamifyResponse(messageHandler);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwwREFBdUQ7QUFDdkQsMERBQXVEO0FBR3ZELDRFQUE2RztBQWU3RyxNQUFNLFFBQVEsR0FBRyw2Q0FBNkMsQ0FBQTtBQUU5RCxNQUFNLE1BQU0sR0FBRyxJQUFJLGVBQU0sRUFBRSxDQUFDO0FBQzVCLE1BQU0sTUFBTSxHQUFHLElBQUksZUFBTSxFQUFFLENBQUM7QUFJNUIsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFLckcsS0FBSyxVQUFVLG1CQUFtQixDQUFDLFFBQWdCLEVBQUUsTUFBVyxFQUFFLGNBQXFDO0lBRW5HLE1BQU0sWUFBWSxHQUFHLDJpQkFBMmlCLENBQUM7SUFHamtCLE1BQU0sVUFBVSxHQUFHO29CQUNILE1BQU0sQ0FBQyxLQUFLOzBCQUNOLE1BQU0sQ0FBQyxXQUFXOzRCQUNoQixNQUFNLENBQUMsV0FBVyxJQUFJLE1BQU0sQ0FBQyxvQkFBb0I7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7MEJBeUJuRCxRQUFROztpSEFFK0UsQ0FBQztJQUU5RyxNQUFNLE9BQU8sR0FBRztRQUNaLFFBQVEsRUFBRTtZQUNOO2dCQUNJLElBQUksRUFBRSxNQUFNO2dCQUNaLE9BQU8sRUFBRTtvQkFDTDt3QkFDSSxNQUFNLEVBQUUsTUFBTTt3QkFDZCxNQUFNLEVBQUUsVUFBVTtxQkFDckI7aUJBQ0o7YUFDSjtTQUNKO1FBQ0QsVUFBVSxFQUFFLElBQUk7UUFDaEIsTUFBTSxFQUFFLFlBQVk7UUFDcEIsV0FBVyxFQUFFLEdBQUc7UUFDaEIsY0FBYyxFQUFFLENBQUMsV0FBVyxDQUFDO1FBQzdCLGlCQUFpQixFQUFFLG9CQUFvQjtLQUN4QyxDQUFDO0lBQ0osTUFBTSxNQUFNLEdBQUc7UUFDWCxPQUFPLEVBQUUsUUFBUTtRQUNqQixXQUFXLEVBQUUsa0JBQWtCO1FBQy9CLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDO1FBQzdCLHdCQUF3QixFQUFFLFVBQW1CO0tBQ2hELENBQUM7SUFDRixJQUFJLFVBQVUsR0FBRyxFQUFFLENBQUM7SUFDcEIsSUFBSTtRQUNBLElBQUk7WUFDQSxJQUFJLFlBQVksR0FBRyxJQUFJLENBQUM7WUFDeEIsSUFBSSxpQkFBaUIsR0FBRyxFQUFFLENBQUM7WUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBSSw2REFBb0MsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUNqRSxNQUFNLFFBQVEsR0FBRyxNQUFNLG9CQUFvQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMxRCxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO1lBQzdCLElBQUksS0FBSyxFQUFFLE1BQU0sS0FBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLEVBQUU7Z0JBQ3BDLDhEQUE4RDtnQkFDOUQsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFO29CQUNmLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQzlCLElBQUksV0FBVyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQzVDLENBQUM7b0JBQ0YsSUFBSSxhQUFhLENBQUMsSUFBSSxLQUFNLHFCQUFxQixJQUFJLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLFlBQVksRUFBQzt3QkFFN0YsTUFBTSxJQUFJLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7d0JBRXRDLGdEQUFnRDt3QkFDaEQsNEJBQTRCO3dCQUM1QixNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7d0JBQ3RDLFVBQVUsSUFBSSxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQzt3QkFFdkMsSUFBRyxZQUFZLEVBQUM7NEJBQ1osaUJBQWlCLElBQUksSUFBSSxDQUFDOzRCQUMxQixJQUFJLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRTtnQ0FDM0MsWUFBWSxHQUFHLEtBQUssQ0FBQztnQ0FDckIsTUFBTSxVQUFVLEdBQUcsaUJBQWlCLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxNQUFNLENBQUM7Z0NBQ25GLE1BQU0sYUFBYSxHQUFHLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQztnQ0FDOUQsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztnQ0FDM0IsY0FBYyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQzs2QkFDckM7eUJBRUo7NkJBQUk7NEJBQ0gsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTt5QkFDM0I7cUJBRUo7aUJBR0Y7cUJBQU07b0JBQ0wsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLEtBQUssRUFBRSxDQUFDLENBQUE7aUJBQ2pDO2FBQ0Y7WUFHRCxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1NBQ2pDO1FBQUMsT0FBTyxHQUFHLEVBQUU7WUFDVixlQUFlO1lBQ2YsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFVLENBQUMsQ0FBQztTQUM1QjtLQUNKO0lBQ0QsT0FBTyxDQUFDLEVBQUU7UUFDTixNQUFNLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3JELFVBQVUsR0FBRyxnQ0FBZ0MsQ0FBQztLQUNqRDtJQUNELE9BQU8sVUFBVSxDQUFDO0FBQ3RCLENBQUM7QUFJRCxLQUFLLFVBQVUsY0FBYyxDQUFFLEtBQTZCLEVBQUUsY0FBcUM7SUFFL0YsSUFBSTtRQUNBLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBWSxDQUFDLENBQUM7UUFFMUIsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN0RCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDO1FBQy9CLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7UUFDM0IsTUFBTSxXQUFXLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQ2hGLDRFQUE0RTtLQUUvRTtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ1osT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUM7S0FDbEM7SUFDRCxjQUFjLENBQUMsR0FBRyxFQUFFLENBQUM7QUFDekIsQ0FBQztBQUVZLFFBQUEsT0FBTyxHQUFHLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFRyYWNlciB9IGZyb20gXCJAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlclwiO1xuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSBcIkBhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyXCI7XG5pbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudFYyLCBIYW5kbGVyLCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbUNvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZVwiO1xuXG5kZWNsYXJlIGdsb2JhbCB7XG4gICAgbmFtZXNwYWNlIGF3c2xhbWJkYSB7XG4gICAgICBmdW5jdGlvbiBzdHJlYW1pZnlSZXNwb25zZShcbiAgICAgICAgZjogKFxuICAgICAgICAgIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudFYyLFxuICAgICAgICAgIHJlc3BvbnNlU3RyZWFtOiBOb2RlSlMuV3JpdGFibGVTdHJlYW0sXG4gICAgICAgICAgY29udGV4dDogQ29udGV4dFxuICAgICAgICApID0+IFByb21pc2U8dm9pZD5cbiAgICAgICk6IEhhbmRsZXI7XG4gICAgfVxufVxuXG5cbmNvbnN0IE1PREVMX0lEID0gXCJ1cy5hbnRocm9waWMuY2xhdWRlLWhhaWt1LTQtNS0yMDI1MTAwMS12MTowXCJcblxuY29uc3QgdHJhY2VyID0gbmV3IFRyYWNlcigpO1xuY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuXG5cblxuY29uc3QgYmVkcm9ja1J1bnRpbWVDbGllbnQgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LlJFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuXG5cblxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVSZWNpcGVTdGVwcyhsYW5ndWFnZTogc3RyaW5nLCByZWNpcGU6IGFueSwgcmVzcG9uc2VTdHJlYW06IE5vZGVKUy5Xcml0YWJsZVN0cmVhbSkge1xuXG4gICAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gXCJZb3VyIHRhc2sgaXMgdG8gZ2VuZXJhdGUgcGVyc29uYWxpemVkIHJlY2lwZSBpZGVhcyBiYXNlZCBvbiB0aGUgdXNlcidzIGlucHV0IG9mIGF2YWlsYWJsZSBpbmdyZWRpZW50cyBhbmQgZGlldGFyeSBwcmVmZXJlbmNlcy4gVXNlIHRoaXMgaW5mb3JtYXRpb24gdG8gc3VnZ2VzdCBhIHZhcmlldHkgb2YgY3JlYXRpdmUgYW5kIGRlbGljaW91cyByZWNpcGVzIHRoYXQgY2FuIGJlIG1hZGUgdXNpbmcgdGhlIGdpdmVuIGluZ3JlZGllbnRzIHdoaWxlIGFjY29tbW9kYXRpbmcgdGhlIHVzZXIncyBkaWV0YXJ5IG5lZWRzLCBpZiBhbnkgYXJlIG1lbnRpb25lZC4gRm9yIGVhY2ggcmVjaXBlLCBwcm92aWRlIGEgYnJpZWYgZGVzY3JpcHRpb24sIGEgbGlzdCBvZiByZXF1aXJlZCBpbmdyZWRpZW50cywgYW5kIGEgc2ltcGxlIHNldCBvZiBpbnN0cnVjdGlvbnMuIEVuc3VyZSB0aGF0IHRoZSByZWNpcGVzIGFyZSBlYXN5IHRvIGZvbGxvdywgbnV0cml0aW91cywgYW5kIGNhbiBiZSBwcmVwYXJlZCB3aXRoIG1pbmltYWwgYWRkaXRpb25hbCBpbmdyZWRpZW50cyBvciBlcXVpcG1lbnQuXCI7XG5cblxuICAgIGNvbnN0IHByb21wdFRleHQgPSBgXG4gICAgUmVjaXBlZSB0aXRsZToke3JlY2lwZS50aXRsZX1cbiAgICBSZWNpcGVlIGRlc2NyaXB0aW9uOiR7cmVjaXBlLmRlc2NyaXB0aW9ufVxuICAgIEF2YWlsYWJsZSBpbmdyZWRpZW50czoke3JlY2lwZS5pbmdyZWRpZW50c30gJHtyZWNpcGUub3B0aW9uYWxfaW5ncmVkaWVudHN9XG4gICAgXG4gICAgQW5zd2VyIG11c3QgYmUgaW4gdGhlIGZvbGxvd2luZyBtYXJrZG93biBmb3JtYXQ6XG4gICAgIyMjIFN0ZXAgMTogW1N0ZXAgVGl0bGVdXG4gICAgLSBBY3Rpb24gMTogW0FjdGlvbiBkZXNjcmlwdGlvbl0gXG4gICAgLSBBY3Rpb24gMjogW0FjdGlvbiBkZXNjcmlwdGlvbl1cblxuICAgICoqSW5ncmVkaWVudHM6KiogW0luZ3JlZGllbnQgMV0sIFtJbmdyZWRpZW50IDJdLCBbSW5ncmVkaWVudCAzXVxuXG4gICAgIyMjIFN0ZXAgMjogW1N0ZXAgVGl0bGVdXG4gICAgLSBBY3Rpb24gMTogW0FjdGlvbiBkZXNjcmlwdGlvbl1cbiAgICAtIEFjdGlvbiAyOiBbQWN0aW9uIGRlc2NyaXB0aW9uXVxuXG4gICAgKipJbmdyZWRpZW50czoqKiBbSW5ncmVkaWVudCAxXSwgW0luZ3JlZGllbnQgMl1cblxuICAgICMjIyBTdGVwIDM6IFtTdGVwIFRpdGxlXVxuICAgIC0gQWN0aW9uIDE6IFtBY3Rpb24gZGVzY3JpcHRpb25dXG4gICAgLSBBY3Rpb24gMjogW0FjdGlvbiBkZXNjcmlwdGlvbl1cblxuICAgICoqSW5ncmVkaWVudHM6KiogW0luZ3JlZGllbnQgMV0sIFtJbmdyZWRpZW50IDJdLCBbSW5ncmVkaWVudCAzXSwgW0luZ3JlZGllbnQgNF1cblxuICAgIERlc2NyaWJlIHRoZSBhY3Rpb25zIGluIGVhY2ggc3RlcCB3aXRoIGRldGFpbGVkIGJ1dCBjb25jaXNlIGRlc2NyaXB0aW9ucywgaW5jbHVkaW5nIGluZ3JlZGllbnRzIG5lZWRlZCwgcXVhbnRpdGllcywgdGltZSwgYW5kIGFueSBhcHBsaWFuY2VzIHJlcXVpcmVkLiBFbnN1cmUgeW91ciB0b25lIGlzIGVuZ2FnaW5nIGFuZCBmcmllbmRseS5cbiAgICBcbiAgICBPbmx5IHVzZSBpbmdyZWRpZW50cyBwcmVzZW50IGluIHRoZSBwcm92aWRlZCByZWNpcGUuXG5cbiAgICBSZXNwb25zZSBtdXN0IGJlIGluICR7bGFuZ3VhZ2V9LlxuXG4gICAgVGhpbmsgc3RlcCBieSBzdGVwIGFuZCBlbGFib3JhdGUgeW91ciB0aG91Z2h0cyBpbnNpZGUgPHRoaW5raW5nPjwvdGhpbmtpbmc+IHRoZW4gYW5zd2VyIGluIGEgbWFya2Rvd24gZm9ybWF0YDtcblxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAgIG1lc3NhZ2VzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICAgICAgY29udGVudDogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBcInR5cGVcIjogXCJ0ZXh0XCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBcInRleHRcIjogcHJvbXB0VGV4dFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBtYXhfdG9rZW5zOiAxMDAwLFxuICAgICAgICBzeXN0ZW06IHN5c3RlbVByb21wdCxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuNSxcbiAgICAgICAgc3RvcF9zZXF1ZW5jZXM6IFsnPC9hbnN3ZXI+J10sXG4gICAgICAgIGFudGhyb3BpY192ZXJzaW9uOiBcImJlZHJvY2stMjAyMy0wNS0zMVwiXG4gICAgICB9O1xuICAgIGNvbnN0IHBhcmFtcyA9IHtcbiAgICAgICAgbW9kZWxJZDogTU9ERUxfSUQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgYWNjZXB0OiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgIHBlcmZvcm1hbmNlQ29uZmlnTGF0ZW5jeTogJ3N0YW5kYXJkJyBhcyBjb25zdFxuICAgIH07XG4gICAgbGV0IGNvbXBsZXRpb24gPSAnJztcbiAgICB0cnkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbGV0IGFjY3VtdWxhdGluZyA9IHRydWU7XG4gICAgICAgICAgICBsZXQgYWNjdW11bGF0ZWRDaHVua3MgPSAnJztcbiAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW1Db21tYW5kKHBhcmFtcyk7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGJlZHJvY2tSdW50aW1lQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgICAgICAgICBjb25zdCBldmVudHMgPSByZXNwb25zZS5ib2R5O1xuICAgICAgICAgICAgZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiBldmVudHMgfHwgW10pIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayB0aGUgdG9wLWxldmVsIGZpZWxkIHRvIGRldGVybWluZSB3aGljaCBldmVudCB0aGlzIGlzLlxuICAgICAgICAgICAgICAgIGlmIChldmVudC5jaHVuaykge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZGVjb2RlZF9ldmVudCA9IEpTT04ucGFyc2UoXG4gICAgICAgICAgICAgICAgICAgIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShldmVudC5jaHVuay5ieXRlcyksXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgaWYgKGRlY29kZWRfZXZlbnQudHlwZSAgPT09ICdjb250ZW50X2Jsb2NrX2RlbHRhJyAmJiBkZWNvZGVkX2V2ZW50LmRlbHRhLnR5cGUgPT09ICd0ZXh0X2RlbHRhJyl7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gZGVjb2RlZF9ldmVudC5kZWx0YS50ZXh0O1xuXG4gICAgICAgICAgICAgICAgICAgIC8vcmVzcG9uc2VTdHJlYW0ud3JpdGUoZGVjb2RlZF9ldmVudC5kZWx0YS50ZXh0KVxuICAgICAgICAgICAgICAgICAgICAvL2FjY3VtdWxhdGVkQ2h1bmtzICs9IHRleHQ7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGRlY29kZWRfZXZlbnQuZGVsdGEudGV4dCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbXBsZXRpb24gKz0gZGVjb2RlZF9ldmVudC5kZWx0YS50ZXh0O1xuXG4gICAgICAgICAgICAgICAgICAgIGlmKGFjY3VtdWxhdGluZyl7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY2N1bXVsYXRlZENodW5rcyArPSB0ZXh0O1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFjY3VtdWxhdGVkQ2h1bmtzLmluY2x1ZGVzKCc8L3RoaW5raW5nPicpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjdW11bGF0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnRJbmRleCA9IGFjY3VtdWxhdGVkQ2h1bmtzLmluZGV4T2YoXCI8L3RoaW5raW5nPlwiKSArIFwiPC90aGlua2luZz5cIi5sZW5ndGg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nVGV4dCA9IGFjY3VtdWxhdGVkQ2h1bmtzLnN1YnN0cmluZyhzdGFydEluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhyZW1haW5pbmdUZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZVN0cmVhbS53cml0ZShyZW1haW5pbmdUZXh0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZVN0cmVhbS53cml0ZSh0ZXh0KVxuICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgfVxuXG5cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBldmVudCA9ICR7ZXZlbnR9YClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAgIGxvZ2dlci5pbmZvKCdTdHJlYW0gZW5kZWQhJylcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAvLyBoYW5kbGUgZXJyb3JcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihlcnIgYXMgYW55KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIHdoaWxlIGdlbmVyYXRpbmcgc3VtbWFyeTogJHtlfWApO1xuICAgICAgICBjb21wbGV0aW9uID0gXCJFcnJvciB3aGlsZSBnZW5lcmF0aW5nIHN1bW1hcnlcIjtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBsZXRpb247XG59XG5cblxuXG5hc3luYyBmdW5jdGlvbiBtZXNzYWdlSGFuZGxlciAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsIHJlc3BvbnNlU3RyZWFtOiBOb2RlSlMuV3JpdGFibGVTdHJlYW0pIHtcblxuICAgIHRyeSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGV2ZW50IGFzIGFueSk7XG5cbiAgICAgICAgY29uc3QgYm9keSA9IGV2ZW50LmJvZHkgPyBKU09OLnBhcnNlKGV2ZW50LmJvZHkpIDoge307XG4gICAgICAgIGNvbnN0IGxhbmd1YWdlID0gYm9keS5sYW5ndWFnZTtcbiAgICAgICAgY29uc3QgcmVjaXBlID0gYm9keS5yZWNpcGU7XG4gICAgICAgIGNvbnN0IHJlY2lwZVN0ZXBzID0gYXdhaXQgZ2VuZXJhdGVSZWNpcGVTdGVwcyhsYW5ndWFnZSwgcmVjaXBlLCByZXNwb25zZVN0cmVhbSk7XG4gICAgICAgIC8vYXdhaXQgcHV0UHJvZHVjdFN1bW1hcnlUb0R5bmFtb0RCKHByb2R1Y3RDb2RlLCBoYXNoVmFsdWUsIHByb2R1Y3RTdW1tYXJ5KTtcbiAgICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yOlwiLCBlcnJvcik7XG4gICAgfVxuICAgIHJlc3BvbnNlU3RyZWFtLmVuZCgpO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGF3c2xhbWJkYS5zdHJlYW1pZnlSZXNwb25zZShtZXNzYWdlSGFuZGxlcik7Il19