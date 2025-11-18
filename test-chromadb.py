#!/usr/bin/env python3
"""
Test script to verify ChromaDB installation and functionality
"""

import sys
import subprocess
import time
import requests
from pathlib import Path

def test_chromadb_module():
    """Test if ChromaDB module is installed"""
    print("Testing ChromaDB module import...")
    try:
        import chromadb
        print(f"[OK] ChromaDB module found: version {chromadb.__version__ if hasattr(chromadb, '__version__') else 'unknown'}")
        return True
    except ImportError as e:
        print(f"[FAIL] ChromaDB module not found: {e}")
        return False

def test_chromadb_server():
    """Test if ChromaDB server can be started"""
    print("\nTesting ChromaDB server startup...")

    # Create test directory
    test_dir = Path("test_chromadb_data")
    test_dir.mkdir(exist_ok=True)

    # Start ChromaDB server
    # For ChromaDB 1.0.x, we need to use the chroma CLI directly
    cmd = [
        "chroma", "run",
        "--path", str(test_dir),
        "--host", "127.0.0.1",
        "--port", "8000"
    ]

    print(f"Starting server with command: {' '.join(cmd)}")

    try:
        # Start the server process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Give server time to start
        print("Waiting for server to start...")
        time.sleep(3)

        # Check if server is running
        # Try both v1 and v2 endpoints since different versions may use different endpoints
        try:
            # First try v2 endpoint (newer)
            try:
                response = requests.get("http://127.0.0.1:8000/api/v2/heartbeat", timeout=2)
            except:
                # Fall back to v1 endpoint
                response = requests.get("http://127.0.0.1:8000/api/v1/heartbeat", timeout=2)
            if response.status_code == 200:
                print("[OK] ChromaDB server is running and responding")
                return True, process
            else:
                print(f"[FAIL] Server responded with status code: {response.status_code}")
                return False, process
        except requests.exceptions.ConnectionError:
            print("[FAIL] Could not connect to ChromaDB server")
            # Check if process failed
            if process.poll() is not None:
                stdout, stderr = process.communicate(timeout=1)
                print(f"Server process exited with code: {process.returncode}")
                if stderr:
                    print(f"Server error output: {stderr}")
            return False, process

    except Exception as e:
        print(f"[FAIL] Failed to start ChromaDB server: {e}")
        return False, None

def test_py_launcher():
    """Test if 'py -3 -m chromadb' command works (Windows)"""
    if sys.platform != 'win32':
        return True

    print("\nTesting Windows py launcher...")
    try:
        result = subprocess.run(
            ["py", "-3", "-c", "import chromadb; print('ChromaDB imported successfully')"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            print("[OK] py -3 launcher works with ChromaDB")
            return True
        else:
            print(f"[FAIL] py -3 launcher failed: {result.stderr}")
            return False
    except Exception as e:
        print(f"[FAIL] py -3 launcher not available or failed: {e}")
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("ChromaDB Installation and Functionality Test")
    print("=" * 60)

    # Test 1: Module import
    module_ok = test_chromadb_module()

    if not module_ok:
        print("\n[WARNING] ChromaDB module not installed. The application will not be able to use semantic search features.")
        sys.exit(1)

    # Test 2: Windows py launcher (if on Windows)
    if sys.platform == 'win32':
        py_ok = test_py_launcher()
        if not py_ok:
            print("\n[WARNING] py -3 launcher may have issues, but direct python execution works")

    # Test 3: Server startup
    server_ok, process = test_chromadb_server()

    if process:
        print("\nStopping test server...")
        process.terminate()
        time.sleep(1)
        if process.poll() is None:
            process.kill()

    # Clean up test directory
    try:
        import shutil
        shutil.rmtree("test_chromadb_data", ignore_errors=True)
    except:
        pass

    print("\n" + "=" * 60)
    if module_ok and server_ok:
        print("[SUCCESS] All tests passed! ChromaDB is working correctly.")
        print("\nThe application should now be able to:")
        print("- Start ChromaDB server using: chroma run")
        print("- Use semantic search features")
        print("- Store and query document embeddings")
    else:
        print("[FAIL] Some tests failed. Please check the errors above.")
        sys.exit(1)

if __name__ == "__main__":
    main()