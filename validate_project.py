#!/usr/bin/env python3
"""
Simple validation script for FinishLine WPS AI
Checks file structure and basic syntax without requiring dependencies
"""

import os
import sys
import ast

def check_file_exists(filepath):
    """Check if file exists"""
    if os.path.exists(filepath):
        print(f"OK {filepath}")
        return True
    else:
        print(f"ERROR {filepath} - MISSING")
        return False

def check_python_syntax(filepath):
    """Check Python file syntax"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        ast.parse(content)
        print(f"OK {filepath} - Syntax OK")
        return True
    except SyntaxError as e:
        print(f"ERROR {filepath} - Syntax Error: {e}")
        return False
    except Exception as e:
        print(f"WARNING {filepath} - Could not check: {e}")
        return True

def main():
    """Run validation checks"""
    print("FinishLine WPS AI - Project Validation")
    print("=" * 50)
    
    # Required files
    required_files = [
        "apps/api/api_main.py",
        "apps/api/odds.py", 
        "apps/api/scoring.py",
        "apps/api/ocr_stub.py",
        "apps/api/requirements.txt",
        "apps/web/index.html",
        "apps/web/app.js",
        "apps/web/styles.css",
        "vercel.json",
        "README.md"
    ]
    
    # Check file existence
    print("\nFile Structure Check:")
    all_files_exist = True
    for filepath in required_files:
        if not check_file_exists(filepath):
            all_files_exist = False
    
    # Check Python syntax
    print("\nPython Syntax Check:")
    python_files = [
        "apps/api/api_main.py",
        "apps/api/odds.py",
        "apps/api/scoring.py", 
        "apps/api/ocr_stub.py"
    ]
    
    syntax_ok = True
    for filepath in python_files:
        if not check_python_syntax(filepath):
            syntax_ok = False
    
    # Check HTML structure
    print("\nHTML Structure Check:")
    try:
        with open("apps/web/index.html", 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        required_elements = [
            '<title>FinishLine AI',
            '<form id="raceForm">',
            '<script src="app.js">',
            '<link rel="stylesheet" href="styles.css">'
        ]
        
        html_ok = True
        for element in required_elements:
            if element in html_content:
                print(f"OK Found: {element}")
            else:
                print(f"ERROR Missing: {element}")
                html_ok = False
                
    except Exception as e:
        print(f"ERROR HTML check failed: {e}")
        html_ok = False
    
    # Summary
    print("\n" + "=" * 50)
    print("Validation Summary:")
    print(f"Files exist: {'OK' if all_files_exist else 'ERROR'}")
    print(f"Python syntax: {'OK' if syntax_ok else 'ERROR'}")
    print(f"HTML structure: {'OK' if html_ok else 'ERROR'}")
    
    if all_files_exist and syntax_ok and html_ok:
        print("\nProject validation passed! Ready for deployment.")
        return True
    else:
        print("\nProject validation failed. Please fix issues above.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
