from google import genai
import os
import json
import logging
from typing import List, Dict

from expenses.config import CATEGORIES_FILE, DEFAULT_CATEGORIES_FILE


def _load_existing_categories(transaction_type: str = "expense") -> List[str]:
    """Load existing categories from the config file.

    Args:
        transaction_type: "expense" or "income" to filter categories.
    """
    if not CATEGORIES_FILE.exists():
        return _load_default_categories_for_type(transaction_type)

    try:
        with open(CATEGORIES_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, dict) and "categories" in data:
                existing_categories = data["categories"]
            elif isinstance(data, list):
                existing_categories = data
            else:
                return _load_default_categories_for_type(transaction_type)
        logging.info(
            f"Loaded {len(existing_categories)} existing categories from {CATEGORIES_FILE}."
        )
        return existing_categories
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding categories.json: {e}")
        return _load_default_categories_for_type(transaction_type)
    except Exception as e:
        logging.error(f"Error reading categories.json: {e}")
        return _load_default_categories_for_type(transaction_type)


def _load_default_categories_for_type(transaction_type: str = "expense") -> List[str]:
    """Load default categories for a specific transaction type."""
    if not DEFAULT_CATEGORIES_FILE.exists():
        return []

    try:
        with open(DEFAULT_CATEGORIES_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data.get(transaction_type, [])
            elif isinstance(data, list):
                # Old format - all are expense categories
                return data if transaction_type == "expense" else []
    except (json.JSONDecodeError, Exception):
        return []
    return []


def _build_category_guidance(
    existing_categories: List[str], transaction_type: str = "expense"
) -> str:
    """Build category guidance string for the prompt."""
    if not existing_categories:
        return ""
    type_label = "income" if transaction_type == "income" else "expense"
    return (
        f"Please use one of the following {type_label} categories if appropriate: "
        + ", ".join(existing_categories)
        + ". If none are suitable, you may suggest a new, concise category."
    )


def _build_gemini_prompt(
    merchant_names: List[str], category_guidance: str, transaction_type: str = "expense"
) -> str:
    """Build the prompt for Gemini API."""
    merchant_list_str = "\n".join([f"- {name}" for name in merchant_names])

    if transaction_type == "income":
        context = "income sources"
        example_input = """- ACME Corporation
    - PayPal Transfer
    - Dividend Payment"""
        example_output = """{
        "ACME Corporation": "Salary/Wages",
        "PayPal Transfer": "Freelance Income",
        "Dividend Payment": "Dividends"
    }"""
    else:
        context = "merchant names for expenses"
        example_input = """- Starbucks
    - Whole Foods
    - Shell
    - Netflix"""
        example_output = """{
        "Starbucks": "Coffee",
        "Whole Foods": "Groceries",
        "Shell": "Fuel",
        "Netflix": "Subscriptions"
    }"""

    return f"""
    You are an AI assistant that categorizes {context} for personal finance tracking.
    Given a list of names, return a single JSON object that maps each name
    to a concise, relevant category. {category_guidance}

    Example Input:
    {example_input}

    Example Output:
    ```json
    {example_output}
    ```

    Here is the list to categorize:
    {merchant_list_str}

    Return only the JSON object.
    """


def _parse_gemini_response(response_text: str) -> Dict[str, str]:
    """Parse and clean the Gemini API response."""
    cleaned_response = (
        response_text.strip().replace("```json", "").replace("```", "").strip()
    )
    return json.loads(cleaned_response)


def get_gemini_category_suggestions_for_merchants(
    merchant_names: List[str], transaction_type: str = "expense"
) -> Dict[str, str]:
    """Uses the Gemini API to suggest categories for a list of merchant names.

    Args:
        merchant_names: List of merchant/source names to categorize.
        transaction_type: "expense" or "income" to use appropriate categories.

    Returns:
        Dictionary mapping merchant names to suggested categories.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logging.warning("GEMINI_API_KEY not set. Skipping category suggestions.")
        return {}

    client = genai.Client(api_key=api_key)

    existing_categories = _load_existing_categories(transaction_type)
    category_guidance = _build_category_guidance(existing_categories, transaction_type)
    prompt = _build_gemini_prompt(merchant_names, category_guidance, transaction_type)

    try:
        logging.info(
            f"Requesting category suggestions for {len(merchant_names)} merchants from Gemini."
        )
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt
        )
        categories = _parse_gemini_response(response.text)
        logging.info(f"Received {len(categories)} category suggestions from Gemini.")
        return categories
    except Exception as e:
        logging.error(f"Error calling Gemini API or parsing response: {e}")
        return {}
