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


def kv_delete(key):
    requests.get(f'{KV_URL}/del/{key}', headers=_kv_headers(), timeout=10)


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


# Broadcast an update/changelog message to every registered user. Call this
# manually (or from a CI step) after deploying frontend changes — it does not
# run automatically. Protected by the same CRON_SECRET as /api/cron since
# both are "admin-only" actions.
@app.route('/api/announce', methods=['POST'])
def announce():
    auth = request.headers.get('Authorization', '')
    if not CRON_SECRET or auth != f'Bearer {CRON_SECRET}':
        return jsonify({'error': 'Unauthorized'}), 401
    if not KV_URL or not KV_TOKEN:
        return jsonify({'error': 'KV storage not configured'}), 500

    body = request.get_json() or {}
    text = body.get('text')
    if not text:
        return jsonify({'error': 'text required'}), 400

    chat_ids = kv_smembers('users:all')
    sent, failed = 0, 0
    for chat_id in chat_ids:
        try:
            requests.post(
                f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
                json={
                    'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML',
                    'reply_markup': {'inline_keyboard': [[{
                        "text": "Открыть NeuroFlow",
                        "web_app": {"url": MINI_APP_URL}
                    }]]}
                }, timeout=10)
            sent += 1
        except Exception as e:
            failed += 1
            print(f'Failed to announce to {chat_id}: {e}')
    return jsonify({'ok': True, 'sent': sent, 'failed': failed, 'total_users': len(chat_ids)})


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


import re

def today_iso():
    return datetime.now().strftime('%Y-%m-%d')

MOOD_KEYWORDS = {
    5: ['отлично', 'супер', 'прекрасно', 'кайф', 'великолепно'],
    4: ['хорошо', 'норм', 'неплохо', 'бодро'],
    3: ['так себе', 'средне', 'никак', 'обычно'],
    2: ['плохо', 'паршиво', 'фигово', 'грустно', 'устала', 'вымотана'],
    1: ['ужасно', 'отвратительно', 'кошмар', 'невыносимо'],
}
SYMPTOM_KEYWORDS = {
    'headache': ['голова', 'мигрень', 'башка'],
    'cramps': ['живот', 'спазм', 'тянет низ'],
    'bloating': ['вздутие', 'раздуло'],
    'fatigue': ['устал', 'вымотан', 'без сил', 'выжата'],
    'insomnia': ['не спала', 'бессонница', 'не могу уснуть'],
}

def parse_freeform(text):
    """Best-effort regex/keyword parse of a free-text message into structured
    fields. Deliberately simple (no ML) — per the plan, upgrade only if
    traffic justifies it."""
    t = text.lower()
    result = {}

    # Explicit numbers always win over vague keywords — "плохо... но на 4"
    # should record 4, not fall back to the "плохо" keyword guess.
    m = re.search(r'/mood(?:@\w+)?\s*(\d)', t) or re.search(r'настроени\w*\D{0,12}(\d)', t)
    if m:
        result['mood_score'] = max(1, min(5, int(m.group(1))))
    else:
        for score, words in MOOD_KEYWORDS.items():
            if any(w in t for w in words):
                result['mood_score'] = score
                break

    m = re.search(r'/pain(?:@\w+)?\s*(\d+)', t) or re.search(r'\bбол\w*\D{0,12}(\d+)', t)
    if m:
        result['pain_score'] = max(0, min(10, int(m.group(1))))
    elif re.search(r'болит|боль|больно', t):
        result.setdefault('pain_score', None)  # flagged as pain mentioned, intensity unknown

    # Non-greedy, stops at the next /command if the message chains several
    # (e.g. "/ate суп /mood 4") — otherwise a greedy .+ would swallow the
    # rest of the message into the food field.
    m = re.search(r'/ate(?:@\w+)?\s+([^/]+)', text, re.IGNORECASE)
    if m:
        result['food'] = m.group(1).strip()
    elif re.search(r'\bсъела\b|\bпоела\b|\bела\b', t):
        result['food'] = text.strip()

    found_symptoms = []
    for key, words in SYMPTOM_KEYWORDS.items():
        if any(w in t for w in words):
            found_symptoms.append(key)
    if found_symptoms:
        result['symptoms'] = found_symptoms

    return result


def format_confirmation(parsed):
    parts = []
    if 'mood_score' in parsed:
        parts.append(f"настроение {parsed['mood_score']}/5")
    if parsed.get('pain_score') is not None:
        parts.append(f"боль {parsed['pain_score']}/10")
    elif 'pain_score' in parsed:
        parts.append('упомянута боль')
    if parsed.get('symptoms'):
        labels = {'headache':'головная боль','cramps':'тянущие боли','bloating':'вздутие','fatigue':'усталость','insomnia':'бессонница'}
        parts.append(', '.join(labels.get(s, s) for s in parsed['symptoms']))
    if parsed.get('food'):
        parts.append(f"приём пищи — {parsed['food']}")
    return ', '.join(parts) if parts else None


def send_message(chat_id, text, reply_markup=None):
    payload = {'chat_id': chat_id, 'text': text}
    if reply_markup:
        payload['reply_markup'] = reply_markup
    try:
        requests.post(f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage', json=payload, timeout=10)
    except Exception as e:
        print(f'sendMessage failed: {e}')


def answer_callback(callback_id, text=''):
    try:
        requests.post(f'https://api.telegram.org/bot{BOT_TOKEN}/answerCallbackQuery',
                       json={'callback_query_id': callback_id, 'text': text}, timeout=10)
    except Exception as e:
        print(f'answerCallbackQuery failed: {e}')


def commit_bot_log(chat_id, parsed):
    date = today_iso()
    key = f'botlog:{chat_id}:{date}'
    existing = kv_get(key) or {}
    if 'mood_score' in parsed:
        existing['mood_score'] = parsed['mood_score']
    if parsed.get('pain_score') is not None:
        existing['pain_score'] = parsed['pain_score']
    if parsed.get('symptoms'):
        existing['symptoms'] = list(set(existing.get('symptoms', []) + parsed['symptoms']))
    if parsed.get('food'):
        existing.setdefault('meals', []).append(parsed['food'])
    kv_set(key, existing)
    kv_sadd(f'botlog_dates:{chat_id}', date)


# Telegram calls this URL whenever someone messages the bot — but only once
# you've told Telegram this URL exists, via setWebhook (see deployment notes).
# Without setWebhook, this route is dead code: Telegram has no way to know
# your bot even has a webhook to call.
@app.route('/api/webhook', methods=['POST'])
def webhook():
    update = request.get_json() or {}

    # Button taps on the Да/Нет confirmation come in as callback_query, not message.
    cb = update.get('callback_query')
    if cb:
        chat_id = cb.get('message', {}).get('chat', {}).get('id')
        data = cb.get('data', '')
        answer_callback(cb.get('id', ''))
        if not chat_id:
            return jsonify({'ok': True})
        if data == 'confirm_yes':
            pending = kv_get(f'pending:{chat_id}')
            if pending:
                commit_bot_log(chat_id, pending)
                kv_delete(f'pending:{chat_id}')
                send_message(chat_id, 'Записала ✅')
            else:
                send_message(chat_id, 'Нечего подтверждать — попробуй отправить сообщение ещё раз.')
        elif data == 'confirm_no':
            kv_delete(f'pending:{chat_id}')
            send_message(chat_id, 'Хорошо, не записываю. Напиши ещё раз, как правильно.')
        return jsonify({'ok': True})

    message = update.get('message', {})
    text = message.get('text', '')
    chat_id = message.get('chat', {}).get('id')
    if not chat_id:
        return jsonify({'ok': True})

    if text.startswith('/start'):
        kv_delete(f'awaiting:{chat_id}')
        send_message(chat_id,
            'Привет! 🌸 NeuroFlow — твой бережный помощник для отслеживания '
            'менструального цикла, овуляции и самочувствия.\n\n'
            'Команды: /mood — настроение, /pain — боль, /ate — что съела. '
            'Просто отправь команду, и я спрошу, что нужно. Или открой полное приложение кнопкой ниже.',
            reply_markup={'inline_keyboard': [[{'text': 'Открыть NeuroFlow', 'web_app': {'url': MINI_APP_URL}}]]})
        return jsonify({'ok': True})

    if not text:
        return jsonify({'ok': True})

    t_lower = text.lower()

    # Bare commands (no value attached) start a short, unambiguous back-and-forth
    # instead of trying to guess a number out of whatever the person says next.
    if re.match(r'^/mood(?:@\w+)?\s*$', t_lower):
        kv_set(f'awaiting:{chat_id}', 'mood')
        send_message(chat_id, 'Как настроение? Ответь числом от 1 (совсем плохо) до 5 (отлично).')
        return jsonify({'ok': True})
    if re.match(r'^/pain(?:@\w+)?\s*$', t_lower):
        kv_set(f'awaiting:{chat_id}', 'pain')
        send_message(chat_id, 'Насколько сильная боль? Число от 0 (совсем нет) до 10 (невыносимая).')
        return jsonify({'ok': True})
    if re.match(r'^/ate(?:@\w+)?\s*$', t_lower):
        kv_set(f'awaiting:{chat_id}', 'food')
        send_message(chat_id, 'Что съела?')
        return jsonify({'ok': True})

    # If we just asked a targeted question, this message IS the answer to
    # exactly that question — no need to guess between several possible
    # fields the way the general free-text parser does.
    awaiting = kv_get(f'awaiting:{chat_id}')
    if awaiting:
        kv_delete(f'awaiting:{chat_id}')
        if awaiting == 'mood':
            m = re.search(r'\d', text)
            if not m:
                for score, words in MOOD_KEYWORDS.items():
                    if any(w in t_lower for w in words):
                        m = score
                        break
            if m is None:
                send_message(chat_id, 'Не поняла. Просто пришли число от 1 до 5.')
                return jsonify({'ok': True})
            score = max(1, min(5, int(m.group(0)) if hasattr(m, 'group') else m))
            parsed = {'mood_score': score}
        elif awaiting == 'pain':
            m = re.search(r'\d+', text)
            if not m:
                send_message(chat_id, 'Не поняла. Просто пришли число от 0 до 10.')
                return jsonify({'ok': True})
            parsed = {'pain_score': max(0, min(10, int(m.group(0))))}
        else:  # food
            parsed = {'food': text.strip()}

        summary = format_confirmation(parsed)
        kv_set(f'pending:{chat_id}', parsed)
        send_message(chat_id, f'Записала: {summary}. Всё верно?', reply_markup={
            'inline_keyboard': [[
                {'text': 'Да', 'callback_data': 'confirm_yes'},
                {'text': 'Нет', 'callback_data': 'confirm_no'},
            ]]
        })
        return jsonify({'ok': True})

    # No pending question — fall back to the general free-text parser for
    # spontaneous messages like "болит живот, съела суп".
    parsed = parse_freeform(text)
    summary = format_confirmation(parsed)
    if not summary:
        send_message(chat_id, 'Не поняла, что записать. Попробуй, например: "настроение хорошее", "болит живот 6", "съела суп" — или отправь /mood, /pain, /ate отдельной командой.')
        return jsonify({'ok': True})

    kv_set(f'pending:{chat_id}', parsed)
    send_message(chat_id, f'Записала: {summary}. Всё верно?', reply_markup={
        'inline_keyboard': [[
            {'text': 'Да', 'callback_data': 'confirm_yes'},
            {'text': 'Нет', 'callback_data': 'confirm_no'},
        ]]
    })
    return jsonify({'ok': True})


# Not linked from anywhere in the app — reachable only if you know the URL.
# The CRON_SECRET is typed in by hand each visit and never stored, so it
# isn't sitting in this page's HTML/JS for anyone who stumbles on the URL
# to read straight out of view-source.
ADMIN_PAGE = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>NeuroFlow — Admin</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f1419; color: #f1f5f9; margin: 0; padding: 24px 20px 60px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.sub { color: #94a3b8; font-size: 13px; margin-top: 0; margin-bottom: 24px; }
  label { display: block; font-size: 13px; color: #94a3b8; font-weight: 600; margin-bottom: 8px; margin-top: 18px; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.2); background: #1e293b; color: #f1f5f9; font-size: 14px; font-family: inherit; }
  textarea { min-height: 120px; resize: vertical; }
  button { margin-top: 20px; width: 100%; padding: 14px; border-radius: 14px; border: none; background: #38bdf8; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: 0.5; }
  #result { margin-top: 16px; padding: 12px 14px; border-radius: 12px; font-size: 13px; white-space: pre-wrap; display: none; }
  #result.ok { display: block; background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.3); }
  #result.err { display: block; background: rgba(248,113,113,0.12); color: #f87171; border: 1px solid rgba(248,113,113,0.3); }
</style>
</head>
<body>
  <h1>Рассылка обновления</h1>
  <p class="sub">Уйдёт всем зарегистрированным пользователям бота.</p>

  <label for="secret">CRON_SECRET</label>
  <input id="secret" type="password" placeholder="вставь секрет" autocomplete="off" />

  <label for="text">Текст сообщения</label>
  <textarea id="text" placeholder="🎉 Новое в NeuroFlow:&#10;• ..."></textarea>

  <button id="send">Отправить всем</button>
  <div id="result"></div>

  <script>
    document.getElementById('send').onclick = async () => {
      const secret = document.getElementById('secret').value.trim();
      const text = document.getElementById('text').value.trim();
      const btn = document.getElementById('send');
      const result = document.getElementById('result');
      result.className = ''; result.style.display = 'none';
      if (!secret || !text) { alert('Заполни секрет и текст'); return; }
      btn.disabled = true; btn.textContent = 'Отправка...';
      try {
        const r = await fetch('/api/announce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret },
          body: JSON.stringify({ text }),
        });
        const data = await r.json();
        if (r.ok && data.ok) {
          result.className = 'ok';
          result.textContent = `Готово. Отправлено: ${data.sent}, ошибок: ${data.failed}, всего пользователей: ${data.total_users}`;
        } else {
          result.className = 'err';
          result.textContent = 'Ошибка: ' + (data.error || r.status);
        }
      } catch (e) {
        result.className = 'err';
        result.textContent = 'Ошибка сети: ' + e.message;
      }
      result.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Отправить всем';
    };
  </script>
</body>
</html>"""


@app.route('/api/logs', methods=['GET'])
def get_bot_logs():
    chat_id = request.args.get('chat_id')
    if not chat_id:
        return jsonify({'error': 'chat_id required'}), 400
    dates = kv_smembers(f'botlog_dates:{chat_id}')
    logs = {}
    for date in dates:
        entry = kv_get(f'botlog:{chat_id}:{date}')
        if entry:
            logs[date] = entry
    return jsonify({'ok': True, 'logs': logs})


@app.route('/admin', methods=['GET'])
def admin_page():
    return ADMIN_PAGE, 200, {'Content-Type': 'text/html; charset=utf-8'}
