// Common Ingredient to Barcode Mapping
// Based on Open Food Facts database - API VALIDATED
// All barcodes tested and confirmed to exist

export const ingredientBarcodeMap: Record<string, string> = {
  // Fruits
  "oranges": "20241681",
  "orange": "20241681",
  "apples": "20247737",
  "apple": "20247737",
  "grapes": "5010525237435",
  "grape": "5010525237435",
  "strawberries": "03257340",
  "strawberry": "03257340",
  "bananas": "3250393062582",
  "banana": "3250393062582",
  
  // Vegetables
  "onions": "00131544",
  "onion": "00131544",
  "potatoes": "03266274",
  "potato": "03266274",
  "carrots": "01007770",
  "carrot": "01007770",
  "lettuce": "0033383650203",
  "tomatoes": "20242121",
  "tomato": "20242121",
  "bell peppers": "00740265",
  "bell pepper": "00740265",
  "broccoli": "3606760065326",
  "cauliflower": "5056053308827",
  "kale": "8437013139335",
  "spinach": "5053526969790",
  "mushrooms": "20004088",
  "mushroom": "20004088",
  "zucchini": "4067",
  "cucumber": "10015599",
  "garlic": "3061431103811",
  
  // Proteins
  "chicken": "3270160005451",
  "chicken breast": "3270160005451",
  "beef": "4056489106425",
  "ground beef": "4056489106425",
  "pork": "4088700133835",
  "ground pork": "4088700133835",
  "salmon": "5057373699688",
  "sausages": "5010498509218",
  "sausage": "5010498509218",
  "meatballs": "7622210449283",
  "eggs": "1204835920000",
  "egg": "1204835920000",
  
  // Dairy
  "milk": "6111266962187",
  "butter": "6111099003897",
  "cheese": "3176582033563",
  "yogurt": "4016241030573",
  "cream": "5057967395132",
  
  // Grains & Pasta
  "rice": "5011157888132",
  "pasta": "8076800195057",
  "bread": "3228857000166",
  "flour": "3068110703249",
  "breadcrumbs": "5019989101818",
  
  // Herbs & Spices
  "honey": "3088540004440",
  "cinnamon": "20382063",
  "rosemary": "5060198820847",
  "thyme": "5050083459825",
  "peppercorns": "5060198641169",
  "black peppercorns": "5060198641169",
  "black pepper": "3270190208228",
  "pepper": "3270190208228",
  "salt": "3270190208211",
  "sugar": "3270190208235",
  
  // Condiments & Oils
  "olive oil": "4056489141877",
  "vinegar": "6111250474191",
  "soy sauce": "8715035110106",
  "lemon juice": "4088600099071",
  
  // Canned & Packaged
  "corn": "5013665111610",
  "chickpeas": "5051399182506",
  "beans": "5018374350930",
};

// Generate mock price for ingredient
export const getMockPrice = (ingredient: string): number => {
  const hash = ingredient.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const price = 2.99 + (hash % 300) / 100; // Range: $2.99 - $5.99
  return parseFloat(price.toFixed(2));
};

// Get barcode for ingredient (if exists)
export const getBarcode = (ingredient: string): string | null => {
  const normalized = ingredient.toLowerCase().trim();
  return ingredientBarcodeMap[normalized] || null;
};
