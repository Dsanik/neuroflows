from flask import Flask, request, jsonify
from datetime import datetime
import json, os, requests

app = Flask(__name__)

BOT_TOKEN = os.environ.get('BOT_TOKEN', '')
CRON_SECRET = os.environ.get('CRON_SECRET', '')
DATA_FILE = '/tmp/users.json'

def load_data():
    try:
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f)

@app.route('/api/register', methods=['POST'])
def register():
    body = request.get_json() or {}
    chat_id = body.get('chat_id')
    settings = body.get('settings', {})
    if not chat_id:
        return jsonify({'error': 'chat_id required'}), 400
    data = load_data()
    data[str(chat_id)] = {
        'settings': settings,
        'registered_at': datetime.now().isoformat()
    }
    save_data(data)
    return jsonify({'ok': True})

@app.route('/api/cron', methods=['GET'])
def cron():
    auth = request.headers.get('Authorization', '')
    if auth != f'Bearer {CRON_SECRET}':
        return jsonify({'error': 'Unauthorized'}), 401
    data = load_data()
    sent = 0
    for chat_id, user in data.items():
        settings = user.get('settings', {})
        if settings.get('periodReminder'):
            msg = "🔔 NeuroFlow: Не забудьте отметить самочувствие!"
            try:
                requests.post(f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
                    json={'chat_id': chat_id, 'text': msg,
                          'reply_markup': {'inline_keyboard': [[{
                              "text": "Открыть NeuroFlow",
                              "web_app": {"url": "https://dsanik.github.io/neuroflows/"}
                          }]]}}, timeout=10)
                sent += 1
            except Exception as e:
                print(f'Failed to send to {chat_id}: {e}')
    return jsonify({'ok': True, 'sent': sent})

@app.route('/api/notify', methods=['POST'])
def notify():
    body = request.get_json() or {}
    chat_id = body.get('chat_id')
    text = body.get('text')
    if not chat_id or not text:
        return jsonify({'error': 'chat_id and text required'}), 400
    try:
        r = requests.post(f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
            json={'chat_id': chat_id, 'text': text}, timeout=10)
        return jsonify({'ok': r.status_code == 200})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
