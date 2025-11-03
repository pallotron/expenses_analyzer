import pytest
from expenses.analysis import calculate_trends

def test_increasing_trend():
    """Test a simple increasing list of numbers."""
    data = [10, 20, 30, 40]
    expected = [(10, '-'), (20, '↑'), (30, '↑'), (40, '↑')]
    assert calculate_trends(data) == expected

def test_decreasing_trend():
    """Test a simple decreasing list of numbers."""
    data = [40, 30, 20, 10]
    expected = [(40, '-'), (30, '↓'), (20, '↓'), (10, '↓')]
    assert calculate_trends(data) == expected

def test_stable_trend():
    """Test a list of numbers that are all the same."""
    data = [50, 50, 50, 50]
    expected = [(50, '-'), (50, '='), (50, '='), (50, '=')]
    assert calculate_trends(data) == expected

def test_mixed_trend():
    """Test a list with a mix of increasing, decreasing, and stable trends."""
    data = [25, 50, 50, 40, 80]
    expected = [(25, '-'), (50, '↑'), (50, '='), (40, '↓'), (80, '↑')]
    assert calculate_trends(data) == expected

def test_with_zeros():
    """Test a list that includes zeros."""
    data = [10, 0, 0, 10]
    expected = [(10, '-'), (0, '↓'), (0, '='), (10, '↑')]
    assert calculate_trends(data) == expected

def test_empty_list():
    """Test an empty list, which should return an empty list."""
    data = []
    expected = []
    assert calculate_trends(data) == expected

def test_single_element_list():
    """Test a list with only one element."""
    data = [100]
    expected = [(100, '-')]
    assert calculate_trends(data) == expected
