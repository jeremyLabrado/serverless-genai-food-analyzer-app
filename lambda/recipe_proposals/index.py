import time
import boto3
import base64
import json
import uuid
from botocore.exceptions import ClientError
import urllib.request
import urllib.parse
import urllib.error
import json
import os
import re
import xml.etree.ElementTree as ET
from aws_lambda_powertools import Logger, Tracer
import concurrent.futures
from functools import partial



bedrock_rt = boto3.client("bedrock-runtime")
s3 = boto3.client('s3')

S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']

tracer = Tracer()
logger = Logger()

def call_bedrock_thread(prompt, model_id, accept, content_type):
    body=json.dumps({
        "text_prompts": [
        {
        "text": f"Close up picture of tasty {prompt}"
        }
    ],
    "cfg_scale": 10,
    "seed": 0,
    "steps": 35,
    "samples" : 1,
    "style_preset" : "photographic"
    })

    response = bedrock_rt.invoke_model(
        body=body, modelId=model_id, accept=accept, contentType=content_type
    )
    response_body = json.loads(response.get("body").read())
    base64_image = response_body.get("artifacts")[0].get("base64")
    return base64_image

def upload_image_to_s3(image_bytes):
    list_url_s3=[]
    for image in image_bytes:
        image_data=base64.b64decode(image)
        # Generate a random filename using UUID
        file_name = str(uuid.uuid4()) + ".jpg"
        s3_key = "img/" + file_name
        s3.put_object(Body=image_data, Bucket=S3_BUCKET_NAME, Key=s3_key)
        list_url_s3.append(f"img/{file_name}")
        logger.debug("Uploaded image:", file_name)

    return list_url_s3

def generate_images_recipes(prompt_list:list):
    """
    Generate an image using SDXL 1.0 on demand.
    Args:
        model_id (str): The model ID to use.
        body (str) : The request body to use.
    Returns:
        image_bytes (bytes): The image generated by the model.
    """
   
    accept = "application/json"
    content_type = "application/json"
    model_id = 'stability.stable-diffusion-xl-v1'
    
    partial_generate_image = partial(
        call_bedrock_thread,
        model_id=model_id,
        accept=accept,
        content_type=content_type
    )

    logger.debug("Generating images with SDXL model %s", model_id)
    
    
    with concurrent.futures.ThreadPoolExecutor() as executor:
        # Use executor.map to apply the function to each prompt concurrently
        results = executor.map(partial_generate_image, prompt_list)
        #Store the results in the result_list
        result_lits=[base64_image for base64_image in results]
    
    return result_lits

def post_process_answer(response:str)->list:
    """
    Extracts the answer from the given response string.

    Args:
        response (str): The response string.

    Returns:
        dict: list of recipes.
    """
    answer = re.findall(r'<answer>(.*?)</answer>', response, re.DOTALL)
    json_answer = json.loads(answer[0])
    return json_answer
    
def generate_answer(prompt:str, model_id:str, claude_config:dict,system_prompt:str, post_process:bool)->str:
    
    message={'messages': [{"role": "user", "content": prompt},
                          {"role": "assistant", "content": "The answer is"}]}
    
    body={**message,**claude_config, "system": system_prompt}
    response = bedrock_rt.invoke_model(modelId=model_id, body=json.dumps(body))
    response = json.loads(response['body'].read().decode('utf-8'))
    if post_process:
        formated_response= post_process_answer(response['content'][0]['text'])
    else:
        formated_response= response['content'][0]['text']
        
    return formated_response
    

@logger.inject_lambda_context(log_event=True)
def handler(event, context):
    
       #-----for prod-----

    body = event.get("body")
    json_body = json.loads(body)
    
    language = json_body.get("language")
    ingredients = json_body.get("ingredients")
    allergies = json_body.get("allergies")
    preferences = json_body.get("preferences")
    
    
    model_id = "anthropic.claude-3-sonnet-20240229-v1:0"
    claude_config = {
        'max_tokens': 2000, 
        'temperature': 0, 
        'anthropic_version': '',  
        'top_p': 1, 
        'stop_sequences': ['Human:']
    }
    
    system_prompt="Your task is to generate personalized recipe ideas based on the user's input of available ingredients and dietary preferences. Use this information to suggest a variety of creative and delicious recipes that can be made using the given ingredients while accommodating the user's dietary needs, if any are mentioned. For each recipe, provide a brief description, a list of required ingredients, and a simple set of instructions. Ensure that the recipes are easy to follow, nutritious, and can be prepared with minimal additional ingredients or equipment."
    
    # nosemgrep
    prompt="""
    Create maximum 3 recipee (easy, medium, hard) based my ingredients, preferences and allergies.:
    Available ingredients: %s
    Allergies: %s
    Dietary preferences: %s
    
    Optinal ingredients are common ingredients that can be added to the recipee like salt, pepper, olive oil, etc. but can not contain ingredients in the allergies list.

    Output the recipee in the following language %s as JSON, following the format, keys of JSON stays in English:
    ```json
    "recipes": [
        {
        "recipe_title": "Succulent Grilled Cheese Sandwich",
        "description": "Un classique réconfortant et savoureux, parfait pour un repas rapide.",
        "difficulty": "facile",
        "ingredients": %s
        "optional_ingredients": ["ingredient1", "ingredient2"],
        "preparation_time": 5,
        "cooking_time": 6
        },
        {
        "recipe_title": "Délicieuse Spaghetti Carbonara",
        "description": "Des spaghettis crémeuses enrobées d'une sauce aux œufs, parmesan et lardons croustillants.",
        "ingredients": %s,
        "optional_ingredients": ["ingredient1", "ingredient2"],
        "difficulty": "moyen",
        "preparation_time": 10,
        "cooking_time": 15
        }
    ]
    }
    ```
    The "ingredients" key should only contain ingedients from %s.
    
    Ensure there is no %s in the recipee.
    Before answer think step by step in <thinking> tags and analyze all rules. Answer must be inside <answer></answer> tags."
    """%(ingredients,allergies,preferences,language,ingredients,ingredients,ingredients,allergies)
    response=generate_answer( prompt, model_id, claude_config,system_prompt,post_process=True)
    prompt_images=[f"{recipee['recipe_title']}.{recipee['description']}" for recipee in response['recipes']]
    image_data=generate_images_recipes(prompt_images)
    # Upload images to S3
    list_url_s3=upload_image_to_s3(image_data)
    for i,recipee in enumerate(response['recipes']):
        recipee['recipee_id']=f"{uuid.uuid4()}"
        recipee['image_url']=f"/{list_url_s3[i]}"
    



    # Return JSON response
    return {
        "statusCode": 200,
        "body": json.dumps(response, ensure_ascii=False),
        "headers": {
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        },
    }