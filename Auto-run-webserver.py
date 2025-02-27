import subprocess
import time
import psutil
import os

def is_process_running(process_name):
    """Check if there is any running process that contains the given name."""
    for proc in psutil.process_iter(['pid', 'name']):
        if process_name.lower() in proc.info['name'].lower():
            return True
    return False

def start_server():
    """Start the server using the batch file."""
    dir_path = os.path.dirname(os.path.realpath(__file__))
    subprocess.Popen(
        ['cmd', '/c', 'start', os.path.join(dir_path, 'run.bat')],
        cwd=dir_path
    )

def main():
    server_started = False
    while True:
        if is_process_running('node'):
            if not server_started:
                print("Server has been confirmed to be running")
                server_started = True
        else:
            if server_started:
                print("Server has stopped running")
                server_started = False
            else:
                print("Attempting to start server...")
                start_server()
                time.sleep(5)  # Give some time for the server to start

        time.sleep(1)

if __name__ == "__main__":
    main()