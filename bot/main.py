from flask import Flask, request, jsonify
from datetime import datetime
import json, os, requests, urllib.parse

app = Flask(__name__)

# CORS: the frontend (GitHub Pages) and this backend (Vercel) are on different
# origins. Without these headers, browsers silently block the fetch() call
# from app.js — no error is thrown client-side (it's swallowed by .catch()),
# it just looks like "nothing happens" and total_users stays 0 forever.
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

@app.route('/api/<path:_>', methods=['OPTIONS'])
def cors_preflight(_):
    # Browsers send an OPTIONS preflight before the actual POST for
    # cross-origin requests with a JSON body. Must return 200 with the
    # CORS headers above (added by after_request) or the real request
    # never gets sent.
    return '', 200

BOT_TOKEN = os.environ.get('BOT_TOKEN', '')
CRON_SECRET = os.environ.get('CRON_SECRET', '')
MINI_APP_URL = os.environ.get('MINI_APP_URL', 'https://dsanik.github.io/neuroflows/')

# These two are set automatically once you attach a Vercel KV store to this
# project (Vercel Dashboard -> Storage -> Create Database -> KV). Do NOT use
# /tmp for persistence here — serverless function instances are ephemeral and
# /tmp is not guaranteed to survive between invocations, so data written by
# /api/register can silently vanish before /api/cron ever reads it.
KV_URL = os.environ.get('KV_REST_API_URL', '')
KV_TOKEN = os.environ.get('KV_REST_API_TOKEN', '')


def _kv_headers():
    return {'Authorization': f'Bearer {KV_TOKEN}'}


def kv_set(key, value):
    """Store a JSON-serializable value under key."""
    encoded = urllib.parse.quote(json.dumps(value), safe='')
    r = requests.get(f'{KV_URL}/set/{key}/{encoded}', headers=_kv_headers(), timeout=10)
    return r.ok


def kv_get(key):
    """Retrieve and JSON-decode a value, or None if missing/unset."""
    r = requests.get(f'{KV_URL}/get/{key}', headers=_kv_headers(), timeout=10)
    result = r.json().get('result')
    if not result:
        return None
    try:
        return json.loads(result)
    except (TypeError, ValueError):
        return None


def kv_sadd(key, member):
    encoded = urllib.parse.quote(str(member), safe='')
    requests.get(f'{KV_URL}/sadd/{key}/{encoded}', headers=_kv_headers(), timeout=10)


def kv_smembers(key):
    r = requests.get(f'{KV_URL}/smembers/{key}', headers=_kv_headers(), timeout=10)
    return r.json().get('result', []) or []


@app.route('/api/register', methods=['POST'])
def register():
    if not KV_URL or not KV_TOKEN:
        return jsonify({'error': 'KV storage not configured — attach a Vercel KV store to this project'}), 500
    body = request.get_json() or {}
    chat_id = body.get('chat_id')
    settings = body.get('settings', {})
    if not chat_id:
        return jsonify({'error': 'chat_id required'}), 400
    chat_id = str(chat_id)
    kv_set(f'user:{chat_id}', {
        'settings': settings,
        'lastPeriodStart': body.get('lastPeriodStart'),
        'profile': body.get('profile'),
        'registered_at': datetime.now().isoformat(),
    })
    kv_sadd('users:all', chat_id)
    return jsonify({'ok': True})


@app.route('/api/cron', methods=['GET'])
def cron():
    auth = request.headers.get('Authorization', '')
    if not CRON_SECRET or auth != f'Bearer {CRON_SECRET}':
        return jsonify({'error': 'Unauthorized'}), 401
    if not KV_URL or not KV_TOKEN:
        return jsonify({'error': 'KV storage not configured'}), 500

    chat_ids = kv_smembers('users:all')
    sent = 0
    for chat_id in chat_ids:
        user = kv_get(f'user:{chat_id}')
        if not user:
            continue
        settings = user.get('settings', {})
        if settings.get('periodReminder'):
            msg = "🔔 NeuroFlow: Не забудьте отметить самочувствие!"
            try:
                requests.post(
                    f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
                    json={
                        'chat_id': chat_id, 'text': msg,
                        'reply_markup': {'inline_keyboard': [[{
                            "text": "Открыть NeuroFlow",
                            "web_app": {"url": MINI_APP_URL}
                        }]]}
                    }, timeout=10)
                sent += 1
            except Exception as e:
                print(f'Failed to send to {chat_id}: {e}')
    return jsonify({'ok': True, 'sent': sent, 'total_users': len(chat_ids)})


@app.route('/api/notify', methods=['POST'])
def notify():
    body = request.get_json() or {}
    chat_id = body.get('chat_id')
    text = body.get('text')
    if not chat_id or not text:
        return jsonify({'error': 'chat_id and text required'}), 400
    try:
        r = requests.post(
            f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
            json={'chat_id': chat_id, 'text': text}, timeout=10)
        return jsonify({'ok': r.status_code == 200})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Regular browser-style downloads (blob: URLs + a synthetic <a download> click)
# are unreliable inside Telegram's in-app WebView — no error is thrown, the
# tap just does nothing. The robust way to hand a file to the user inside
# Telegram is to have the BOT push it into the chat as a document via the
# Bot API's sendDocument, which is exactly what this endpoint does.
@app.route('/api/export', methods=['POST'])
def export_file():
    import base64
    body = request.get_json() or {}
    chat_id = body.get('chat_id')
    filename = body.get('filename')
    content_b64 = body.get('content_base64')
    if not chat_id or not filename or not content_b64:
        return jsonify({'error': 'chat_id, filename and content_base64 required'}), 400
    try:
        file_bytes = base64.b64decode(content_b64)
    except Exception:
        return jsonify({'error': 'invalid base64'}), 400
    try:
        r = requests.post(
            f'https://api.telegram.org/bot{BOT_TOKEN}/sendDocument',
            data={'chat_id': chat_id},
            files={'document': (filename, file_bytes)},
            timeout=20,
        )
        return jsonify({'ok': r.status_code == 200}), (200 if r.status_code == 200 else 502)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Telegram calls this URL whenever someone messages the bot — but only once
# you've told Telegram this URL exists, via setWebhook (see deployment notes).
# Without setWebhook, this route is dead code: Telegram has no way to know
# your bot even has a webhook to call.
@app.route('/api/webhook', methods=['POST'])
def webhook():
    update = request.get_json() or {}
    message = update.get('message', {})
    text = message.get('text', '')
    chat_id = message.get('chat', {}).get('id')
    if not chat_id:
        return jsonify({'ok': True})
    if text.startswith('/start'):
        try:
            requests.post(
                f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
                json={
                    'chat_id': chat_id,
                    'text': (
                        'Привет! 🌸 NeuroFlow — твой бережный помощник для отслеживания '
                        'менструального цикла, овуляции и самочувствия.\n\n'
                        'Нажми кнопку ниже, чтобы начать.'
                    ),
                    'reply_markup': {'inline_keyboard': [[{
                        'text': 'Открыть NeuroFlow',
                        'web_app': {'url': MINI_APP_URL}
                    }]]}
                }, timeout=10)
        except Exception as e:
            print(f'Failed to send welcome message: {e}')
    return jsonify({'ok': True})
