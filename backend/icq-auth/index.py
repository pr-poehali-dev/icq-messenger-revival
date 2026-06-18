"""
ICQ Auth: регистрация без кода, вход через подтверждение по SMS-ссылке.
"""
import json
import os
import random
import secrets
import psycopg2
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-User-Id',
}

def get_db():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def generate_uin():
    return random.randint(100000000, 999999999)

def generate_token():
    return secrets.token_hex(32)

def normalize_phone(phone):
    p = phone.strip().replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
    if not p.startswith('+'):
        p = '+7' + p.lstrip('7').lstrip('8')
    return p

def send_sms(phone, confirm_token, base_url, request_type='login'):
    """Отправляем SMS со ссылками Да/Нет"""
    sms_api_key = os.environ.get('SMSRU_API_KEY', '')
    yes_url = f'{base_url}/confirm-login?token={confirm_token}&answer=yes'
    no_url  = f'{base_url}/confirm-login?token={confirm_token}&answer=no'

    if request_type == 'register':
        msg = f'ICQ: Вы хотите зарегистрировать аккаунт?\nДа: {yes_url}\nНет: {no_url}'
    else:
        msg = f'ICQ: Кто-то входит в ваш аккаунт. Это вы?\nДа: {yes_url}\nНет: {no_url}'

    if not sms_api_key:
        return {'demo': True, 'yes_url': yes_url, 'no_url': no_url}

    params = urllib.parse.urlencode({
        'api_id': sms_api_key,
        'to': phone,
        'msg': msg,
        'json': 1
    })
    url = f'https://sms.ru/sms/send?{params}'
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            return result
    except Exception as e:
        return {'error': str(e)}

def create_session(cur, user_id):
    token = generate_token()
    expires = datetime.now() + timedelta(days=30)
    cur.execute(
        "INSERT INTO icq_sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
        (user_id, token, expires)
    )
    return token

def handler(event: dict, context) -> dict:
    """ICQ Auth: регистрация, подтверждение входа по SMS-ссылке, профиль, выход"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')
    headers_in = event.get('headers', {})
    auth_token = headers_in.get('X-Auth-Token') or headers_in.get('x-auth-token', '')

    base_url = os.environ.get('AUTH_BASE_URL', 'https://functions.poehali.dev/e32fdd23-017b-4fb1-9618-d70e0b0977d0')
    demo_mode = not os.environ.get('SMSRU_API_KEY')

    def make_request(phone, request_type, nickname=''):
        confirm_token = secrets.token_hex(24)
        expires = datetime.now() + timedelta(minutes=10)
        db2 = get_db(); cur2 = db2.cursor()
        cur2.execute(
            "INSERT INTO icq_login_requests (token, phone, status, expires_at, nickname, request_type) "
            "VALUES (%s, %s, 'pending', %s, %s, %s)",
            (confirm_token, phone, expires, nickname, request_type)
        )
        db2.commit(); cur2.close(); db2.close()
        send_sms(phone, confirm_token, base_url, request_type)
        resp = {'success': True, 'request_token': confirm_token, 'demo': demo_mode}
        if demo_mode:
            resp['yes_url'] = f'{base_url}/confirm-login?token={confirm_token}&answer=yes'
            resp['no_url']  = f'{base_url}/confirm-login?token={confirm_token}&answer=no'
        return resp

    # ── POST /register ─────────────────────────────────────────────────────────
    # Новый пользователь: телефон + никнейм → шлём SMS «Хотите зарегистрироваться?»
    if method == 'POST' and '/register' in path:
        body = json.loads(event.get('body') or '{}')
        phone = normalize_phone(body.get('phone', ''))
        nickname = body.get('nickname', '').strip()

        if not phone or not nickname:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Укажите телефон и никнейм'})}

        db = get_db(); cur = db.cursor()
        cur.execute("SELECT id FROM icq_users WHERE phone=%s", (phone,))
        if cur.fetchone():
            cur.close(); db.close()
            return {'statusCode': 409, 'headers': CORS,
                    'body': json.dumps({'error': 'Этот номер уже зарегистрирован. Войди через вход.'})}
        cur.close(); db.close()

        resp = make_request(phone, 'register', nickname)
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(resp)}

    # ── POST /request-login ────────────────────────────────────────────────────
    # Существующий пользователь хочет войти → шлём SMS «Это вы?»
    if method == 'POST' and '/request-login' in path:
        body = json.loads(event.get('body') or '{}')
        phone = normalize_phone(body.get('phone', ''))
        if not phone:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Укажите номер телефона'})}

        db = get_db(); cur = db.cursor()
        cur.execute("SELECT id FROM icq_users WHERE phone=%s", (phone,))
        if not cur.fetchone():
            cur.close(); db.close()
            return {'statusCode': 404, 'headers': CORS,
                    'body': json.dumps({'error': 'Аккаунт с таким номером не найден. Сначала зарегистрируйся.'})}
        cur.close(); db.close()

        resp = make_request(phone, 'login')
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(resp)}

    # ── GET /confirm-login?token=…&answer=yes|no ───────────────────────────────
    if method == 'GET' and '/confirm-login' in path:
        params = event.get('queryStringParameters') or {}
        confirm_token = params.get('token', '')
        answer = params.get('answer', '')

        if not confirm_token or answer not in ('yes', 'no'):
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Некорректный запрос'})}

        db = get_db(); cur = db.cursor()
        cur.execute(
            "SELECT id, phone, status, nickname, request_type FROM icq_login_requests "
            "WHERE token=%s AND expires_at > NOW()",
            (confirm_token,)
        )
        req = cur.fetchone()
        if not req:
            cur.close(); db.close()
            return {
                'statusCode': 200,
                'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                'body': html_page('⏰ Ссылка истекла', 'Эта ссылка уже недействительна.<br>Попробуй снова.', '#e53935')
            }

        if req[2] != 'pending':
            cur.close(); db.close()
            return {
                'statusCode': 200,
                'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                'body': html_page('ℹ️ Уже обработано', 'Этот запрос уже был обработан.', '#ffc107')
            }

        req_id, phone, _, nickname, request_type = req

        if answer == 'no':
            cur.execute("UPDATE icq_login_requests SET status='rejected' WHERE id=%s", (req_id,))
            db.commit(); cur.close(); db.close()
            if request_type == 'register':
                return {'statusCode': 200, 'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                        'body': html_page('❌ Регистрация отменена', 'Регистрация аккаунта ICQ отменена.<br>Можете закрыть эту страницу.', '#e53935')}
            return {'statusCode': 200, 'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                    'body': html_page('🚫 Вход отклонён', 'Вы отклонили вход в ICQ.<br>Если это были не вы — ваш аккаунт в безопасности.', '#e53935')}

        # answer == 'yes'
        if request_type == 'register':
            # Создаём аккаунт прямо здесь
            cur.execute("SELECT id FROM icq_users WHERE phone=%s", (phone,))
            if cur.fetchone():
                cur.execute("UPDATE icq_login_requests SET status='rejected' WHERE id=%s", (req_id,))
                db.commit(); cur.close(); db.close()
                return {'statusCode': 200, 'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                        'body': html_page('⚠️ Уже зарегистрирован', 'Аккаунт с этим номером уже существует.<br>Войди через кнопку «Вход».', '#ffc107')}

            uin = generate_uin()
            while True:
                cur.execute("SELECT id FROM icq_users WHERE uin=%s", (uin,))
                if not cur.fetchone(): break
                uin = generate_uin()

            cur.execute(
                "INSERT INTO icq_users (uin, phone, nickname, status) VALUES (%s, %s, %s, 'offline') RETURNING id",
                (uin, phone, nickname or f'User{uin}')
            )
            cur.execute("UPDATE icq_login_requests SET status='approved' WHERE id=%s", (req_id,))
            db.commit(); cur.close(); db.close()
            return {'statusCode': 200, 'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                    'body': html_page('✅ Аккаунт создан!',
                        f'Добро пожаловать в ICQ, <strong>{nickname}</strong>!<br>'
                        f'Ваш UIN: <strong style="font-size:20px;letter-spacing:2px">{uin}</strong><br><br>'
                        'Вернитесь на страницу регистрации — она обновится автоматически.', '#4caf50')}
        else:
            # login — просто помечаем approved, сессию создадим в poll
            cur.execute("UPDATE icq_login_requests SET status='approved' WHERE id=%s", (req_id,))
            db.commit(); cur.close(); db.close()
            return {'statusCode': 200, 'headers': {**CORS, 'Content-Type': 'text/html; charset=utf-8'},
                    'body': html_page('✅ Вход подтверждён!',
                        'Вы вошли в ICQ.<br>Вернитесь на страницу — она обновится автоматически.<br>Можете закрыть эту вкладку.', '#4caf50')}

    # ── GET /poll-login?token=… ────────────────────────────────────────────────
    if method == 'GET' and '/poll-login' in path:
        params = event.get('queryStringParameters') or {}
        confirm_token = params.get('token', '')
        if not confirm_token:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}

        db = get_db(); cur = db.cursor()
        cur.execute(
            "SELECT id, phone, status, expires_at, nickname, request_type FROM icq_login_requests WHERE token=%s",
            (confirm_token,)
        )
        req = cur.fetchone()
        if not req:
            cur.close(); db.close()
            return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'status': 'not_found'})}

        req_id, phone, req_status, expires_at, nickname, request_type = req

        if expires_at < datetime.now():
            cur.close(); db.close()
            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'status': 'expired'})}

        if req_status == 'approved':
            if request_type == 'register':
                # Аккаунт уже создан в confirm-login, просто находим и выдаём сессию
                cur.execute(
                    "SELECT id, uin, nickname, first_name, last_name, status, avatar_url FROM icq_users WHERE phone=%s",
                    (phone,)
                )
            else:
                cur.execute(
                    "SELECT id, uin, nickname, first_name, last_name, status, avatar_url FROM icq_users WHERE phone=%s",
                    (phone,)
                )
            user = cur.fetchone()
            if not user:
                cur.close(); db.close()
                return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'status': 'pending'})}

            cur.execute("UPDATE icq_users SET status='online', last_seen=NOW() WHERE id=%s", (user[0],))
            session_token = create_session(cur, user[0])
            cur.execute("UPDATE icq_login_requests SET status='used' WHERE id=%s", (req_id,))
            db.commit(); cur.close(); db.close()

            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({
                'status': 'approved',
                'token': session_token,
                'user': {
                    'id': user[0], 'uin': user[1], 'nickname': user[2],
                    'first_name': user[3], 'last_name': user[4],
                    'status': user[5], 'avatar_url': user[6]
                }
            })}

        cur.close(); db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'status': req_status})}

    # ── GET /me ────────────────────────────────────────────────────────────────
    if method == 'GET' and '/me' in path:
        if not auth_token:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "SELECT u.id, u.uin, u.nickname, u.first_name, u.last_name, u.status, u.status_message, u.avatar_url, u.phone "
            "FROM icq_sessions s JOIN icq_users u ON s.user_id=u.id "
            "WHERE s.token=%s AND s.expires_at > NOW()",
            (auth_token,)
        )
        user = cur.fetchone()
        cur.close(); db.close()
        if not user:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Сессия истекла'})}
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({
            'id': user[0], 'uin': user[1], 'nickname': user[2],
            'first_name': user[3], 'last_name': user[4], 'status': user[5],
            'status_message': user[6], 'avatar_url': user[7], 'phone': user[8]
        })}

    # ── PUT /profile ───────────────────────────────────────────────────────────
    if method == 'PUT' and '/profile' in path:
        if not auth_token:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}
        body = json.loads(event.get('body') or '{}')
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT user_id FROM icq_sessions WHERE token=%s AND expires_at > NOW()", (auth_token,))
        session = cur.fetchone()
        if not session:
            cur.close(); db.close()
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет сессии'})}
        user_id = session[0]
        fields, vals = [], []
        for col in ('nickname', 'first_name', 'last_name', 'status_message'):
            if col in body:
                fields.append(f'{col}=%s'); vals.append(body[col])
        if body.get('status') in ('online', 'away', 'busy', 'invisible', 'offline'):
            fields.append('status=%s'); vals.append(body['status'])
        if fields:
            vals.append(user_id)
            cur.execute(f"UPDATE icq_users SET {', '.join(fields)} WHERE id=%s", vals)
            db.commit()
        cur.close(); db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'success': True})}

    # ── POST /logout ───────────────────────────────────────────────────────────
    if method == 'POST' and '/logout' in path:
        if auth_token:
            db = get_db()
            cur = db.cursor()
            cur.execute("SELECT user_id FROM icq_sessions WHERE token=%s", (auth_token,))
            sess = cur.fetchone()
            if sess:
                cur.execute("UPDATE icq_users SET status='offline' WHERE id=%s", (sess[0],))
            cur.execute("UPDATE icq_sessions SET expires_at=NOW() WHERE token=%s", (auth_token,))
            db.commit(); cur.close(); db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'success': True})}

    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}


def html_page(title: str, message: str, color: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} — ICQ</title>
  <style>
    body {{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:linear-gradient(135deg,#1a4a7a,#2878c0); font-family:Tahoma,sans-serif; }}
    .card {{ background:white; border-radius:12px; padding:40px 48px; text-align:center;
             box-shadow:0 20px 60px rgba(0,0,0,0.4); max-width:380px; }}
    .icon {{ font-size:56px; margin-bottom:16px; }}
    h1 {{ margin:0 0 12px; font-size:22px; color:#1c3a5a; }}
    p {{ margin:0; font-size:14px; color:#6a7a8a; line-height:1.6; }}
    .dot {{ display:inline-block; width:12px; height:12px; border-radius:50%; background:{color}; margin-right:6px; vertical-align:middle; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🌸</div>
    <h1><span class="dot"></span>{title}</h1>
    <p>{message}</p>
  </div>
</body>
</html>"""