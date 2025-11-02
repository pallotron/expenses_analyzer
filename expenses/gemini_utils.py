import google.generativeai as genai
import os
import json
import logging


def get_gemini_category_suggestions_for_merchants(merchant_names: list[str]) -> dict[str, str]:
    """
    Uses the Gemini API to suggest categories for a list of merchant names.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logging.warning("GEMINI_API_KEY not set. Skipping category suggestions.")
        return {}

    genai.configure(api_key=api_key)

    model = genai.GenerativeModel('gemini-flash-latest')

    # Create a formatted string of merchant names
    merchant_list_str = "\n".join([f"- {name}" for name in merchant_names])

    prompt = f"""
    You are an AI assistant that categorizes merchant names for personal finance tracking.
    Given a list of merchant names, return a single JSON object that maps each merchant name
    to a concise, relevant category.

    Example Input:
    - Starbucks
    - Whole Foods
    - Shell
    - Netflix

    Example Output:
    ```json
    {{
        "Starbucks": "Coffee",
        "Whole Foods": "Groceries",
        "Shell": "Fuel",
        "Netflix": "Subscriptions"
    }}
    ```

    Here is the list of merchants to categorize:
    {merchant_list_str}

    Return only the JSON object.
    """

    try:
        logging.info(f"Requesting category suggestions for {len(merchant_names)} merchants from Gemini.")
        response = model.generate_content(prompt)
        # Clean the response to extract only the JSON part
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        # Parse the JSON string into a Python dictionary
        categories = json.loads(cleaned_response)
        logging.info(f"Received {len(categories)} category suggestions from Gemini.")
        return categories
    except Exception as e:
        logging.error(f"Error calling Gemini API or parsing response: {e}")
        # Return an empty dict or handle error as appropriate
        return {}
