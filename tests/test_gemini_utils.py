import unittest
from unittest.mock import patch, MagicMock, mock_open
import json
from expenses.gemini_utils import get_gemini_category_suggestions_for_merchants


class TestGeminiUtils(unittest.TestCase):

    @patch.dict("os.environ", {}, clear=True)
    def test_no_api_key(self) -> None:
        """Test that function returns empty dict when API key is not set."""
        result = get_gemini_category_suggestions_for_merchants(["Starbucks"])
        self.assertEqual(result, {})

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("expenses.gemini_utils.genai.Client")
    @patch("expenses.gemini_utils.CATEGORIES_FILE")
    def test_successful_categorization_no_existing_categories(
        self, mock_categories_file: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test successful categorization when no existing categories exist."""
        # Mock the categories file as non-existent
        mock_categories_file.exists.return_value = False

        # Mock the Gemini API response
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = """```json
        {
            "Starbucks": "Coffee",
            "Whole Foods": "Groceries"
        }
        ```"""
        mock_client.models.generate_content.return_value = mock_response
        mock_client_class.return_value = mock_client

        merchants = ["Starbucks", "Whole Foods"]
        result = get_gemini_category_suggestions_for_merchants(merchants)

        self.assertEqual(result, {"Starbucks": "Coffee", "Whole Foods": "Groceries"})
        mock_client.models.generate_content.assert_called_once()

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("expenses.gemini_utils.genai.Client")
    @patch("expenses.gemini_utils.CATEGORIES_FILE")
    def test_successful_categorization_with_existing_categories(
        self, mock_categories_file: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test categorization when existing categories are available."""
        # Mock the categories file
        mock_categories_file.exists.return_value = True
        existing_cats = {"categories": ["Coffee", "Groceries", "Fuel"]}

        with patch("builtins.open", mock_open(read_data=json.dumps(existing_cats))):
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.text = '{"Shell": "Fuel"}'
            mock_client.models.generate_content.return_value = mock_response
            mock_client_class.return_value = mock_client

            result = get_gemini_category_suggestions_for_merchants(["Shell"])

            self.assertEqual(result, {"Shell": "Fuel"})
            # Verify the prompt includes existing categories
            call_args = mock_client.models.generate_content.call_args
            self.assertIn("Coffee", call_args.kwargs["contents"])
            self.assertIn("Groceries", call_args.kwargs["contents"])

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("expenses.gemini_utils.genai.Client")
    @patch("expenses.gemini_utils.CATEGORIES_FILE")
    def test_api_error_handling(
        self, mock_categories_file: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test that API errors are handled gracefully."""
        mock_categories_file.exists.return_value = False

        # Mock the API to raise an exception
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = Exception("API Error")
        mock_client_class.return_value = mock_client

        result = get_gemini_category_suggestions_for_merchants(["Amazon"])

        self.assertEqual(result, {})

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("expenses.gemini_utils.genai.Client")
    @patch("expenses.gemini_utils.CATEGORIES_FILE")
    def test_invalid_json_response(
        self, mock_categories_file: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test handling of invalid JSON in API response."""
        mock_categories_file.exists.return_value = False

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "This is not valid JSON"
        mock_client.models.generate_content.return_value = mock_response
        mock_client_class.return_value = mock_client

        result = get_gemini_category_suggestions_for_merchants(["Target"])

        self.assertEqual(result, {})

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("expenses.gemini_utils.genai.Client")
    @patch("expenses.gemini_utils.CATEGORIES_FILE")
    def test_categories_file_with_list_format(
        self, mock_categories_file: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test when categories file contains a list instead of dict."""
        mock_categories_file.exists.return_value = True
        existing_cats = ["Coffee", "Groceries", "Fuel"]

        with patch("builtins.open", mock_open(read_data=json.dumps(existing_cats))):
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.text = '{"Netflix": "Subscriptions"}'
            mock_client.models.generate_content.return_value = mock_response
            mock_client_class.return_value = mock_client

            result = get_gemini_category_suggestions_for_merchants(["Netflix"])

            self.assertEqual(result, {"Netflix": "Subscriptions"})

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    @patch("expenses.gemini_utils.genai.Client")
    @patch("expenses.gemini_utils.CATEGORIES_FILE")
    def test_empty_merchant_list(
        self, mock_categories_file: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test with empty merchant list."""
        mock_categories_file.exists.return_value = False

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "{}"
        mock_client.models.generate_content.return_value = mock_response
        mock_client_class.return_value = mock_client

        result = get_gemini_category_suggestions_for_merchants([])

        # Should still call API (though it's not optimal)
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
