import requests
import json
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class LMStudioClient:
    def __init__(self, base_url: str = "http://localhost:1234/v1/chat/completions"):
        self.base_url = base_url
        self.headers = {
            "Content-Type": "application/json"
        }
        
    def process_request(self, payload):
        try:
            response = requests.post(
                self.base_url,
                headers=self.headers,
                json=payload,
                stream=True
            )
            
            if response.status_code == 200:
                return response
            else:
                print(f"Error: {response.status_code}")
                print(response.text)
                return None
                
        except requests.exceptions.RequestException as e:
            print(f"Connection error: {e}")
            return None

class InputFileHandler(FileSystemEventHandler):
    def __init__(self, client):
        self.client = client
        self.processing = False
        
    def on_modified(self, event):
        if event.src_path.endswith('input.txt') and not self.processing:
            self.processing = True
            try:
                time.sleep(0.1)
                
                # Read the payload
                with open(event.src_path, 'r', encoding='utf-8') as f:
                    try:
                        payload = json.loads(f.read().strip())
                    except json.JSONDecodeError:
                        print("Invalid JSON payload")
                        return
                
                # Clear output file
                with open('output.txt', 'w', encoding='utf-8') as f:
                    f.write('')
                
                # Process the request
                response = self.client.process_request(payload)
                if response:
                    for line in response.iter_lines():
                        if line:
                            try:
                                json_response = json.loads(line.decode('utf-8').replace('data: ', ''))
                                if json_response.get('choices'):
                                    content = json_response['choices'][0].get('delta', {}).get('content', '')
                                    if content:
                                        with open('output.txt', 'a', encoding='utf-8') as f:
                                            f.write(content)
                            except json.JSONDecodeError:
                                continue
                
            finally:
                self.processing = False
                # Clear input file
                with open(event.src_path, 'w', encoding='utf-8') as f:
                    f.write('')

def main():
    client = LMStudioClient()
    event_handler = InputFileHandler(client)
    observer = Observer()
    observer.schedule(event_handler, path='.', recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == "__main__":
    main()
