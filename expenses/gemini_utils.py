import google.generativeai as genai
import os
import json
import logging
from typing import List, Dict

from expenses.config import CATEGORIES_FILE


def _load_existing_categories() -> List[str]:
    """Load existing categories from the config file."""
    if not CATEGORIES_FILE.exists():
        return []

    try:
        with open(CATEGORIES_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, dict) and "categories" in data:
                existing_categories = data["categories"]
            elif isinstance(data, list):
                existing_categories = data
            else:
                return []
        logging.info(f"Loaded {len(existing_categories)} existing categories from {CATEGORIES_FILE}.")
        return existing_categories
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding categories.json: {e}")
        return []
    except Exception as e:
        logging.error(f"Error reading categories.json: {e}")
        return []


def _build_category_guidance(existing_categories: List[str]) -> str:
    """Build category guidance string for the prompt."""
    if not existing_categories:
        return ""
    return (
        "Please use one of the following categories if appropriate: "
        + ", ".join(existing_categories)
        + ". If none are suitable, you may suggest a new, concise category."
    )


def _build_gemini_prompt(merchant_names: List[str], category_guidance: str) -> str:
    """Build the prompt for Gemini API."""
    merchant_list_str = "\n".join([f"- {name}" for name in merchant_names])

    return f"""
    You are an AI assistant that categorizes merchant names for personal finance tracking.
    Given a list of merchant names, return a single JSON object that maps each merchant name
    to a concise, relevant category. {category_guidance}

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


def _parse_gemini_response(response_text: str) -> Dict[str, str]:
    """Parse and clean the Gemini API response."""
    cleaned_response = response_text.strip().replace("```json", "").replace("```", "").strip()
    return json.loads(cleaned_response)


def get_gemini_category_suggestions_for_merchants(merchant_names: List[str]) -> Dict[str, str]:
    """Uses the Gemini API to suggest categories for a list of merchant names."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logging.warning("GEMINI_API_KEY not set. Skipping category suggestions.")
        return {}

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-flash-latest")

    existing_categories = _load_existing_categories()
    category_guidance = _build_category_guidance(existing_categories)
    prompt = _build_gemini_prompt(merchant_names, category_guidance)

    try:
        logging.info(f"Requesting category suggestions for {len(merchant_names)} merchants from Gemini.")
        response = model.generate_content(prompt)
        categories = _parse_gemini_response(response.text)
        logging.info(f"Received {len(categories)} category suggestions from Gemini.")
        return categories
    except Exception as e:
        logging.error(f"Error calling Gemini API or parsing response: {e}")
        return {}
