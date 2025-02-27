import requests
import time

url = "http://localhost:444"

while True:
    response = requests.post(url, data="Test")
    print(f"Response from server: {response.text}")
    time.sleep(4)