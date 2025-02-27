import subprocess
import discord
from discord.ext import commands

TOKEN = 'MTMyODg0ODkyMTY1MjQ5NDQzOQ.Gcz5Dc.NcffKHESCCXqUxARY8MEKkSQWK6lM3Y23g8784' 
CHANNEL_ID = 1328848517116203115
intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f'logged in')
    await stream_logs()

async def stream_logs():
    channel = bot.get_channel(CHANNEL_ID)
    if channel is None:
        print("Channel not found!")
        return

    process = subprocess.Popen(
        ["lms", "log", "stream"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )

    try:
        for line in iter(process.stdout.readline, ''):
            if line.strip():
                await channel.send(line.strip())
    except Exception as e:
        print(f"Error")
    finally:
        process.terminate()

bot.run(TOKEN)