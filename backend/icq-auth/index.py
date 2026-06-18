"""
ICQ Auth: регистрация, вход, выход, получение профиля.
Отправка SMS через SMS.ru API.
"""
import json
import os
import random
import string
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

def send_sms(phone, code):
    sms_api_key = os.environ.get('SMSRU_API_KEY', '')
    if not sms_api_key:
        return {'demo': True, 'code': code}
    
    msg = f'Ваш код ICQ: {code}'
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

def handler(event: dict, context) -> dict:
    """Авторизация ICQ: отправка кода, верификация, логин, профиль"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')
    headers_in = event.get('headers', {})
    auth_token = headers_in.get('X-Auth-Token') or headers_in.get('x-auth-token', '')

    # POST /send-code — отправить SMS код
    if method == 'POST' and '/send-code' in path:
        body = json.loads(event.get('body') or '{}')
        phone = body.get('phone', '').strip()
        if not phone:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Укажите номер телефона'})}
        
        phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
        if not phone.startswith('+'):
            phone = '+7' + phone.lstrip('7').lstrip('8')
        
        code = str(random.randint(100000, 999999))
        expires = datetime.now() + timedelta(minutes=10)
        
        db = get_db()
        cur = db.cursor()
        cur.execute("INSERT INTO icq_sms_codes (phone, code, expires_at) VALUES (%s, %s, %s)", (phone, code, expires))
        db.commit()
        cur.close()
        db.close()
        
        sms_result = send_sms(phone, code)
        demo_mode = not os.environ.get('SMSRU_API_KEY')
        
        response = {'success': True, 'phone': phone, 'demo': demo_mode}
        if demo_mode:
            response['code'] = code
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(response)}

    # POST /verify-code — проверить код и выдать сессию
    if method == 'POST' and '/verify-code' in path:
        body = json.loads(event.get('body') or '{}')
        phone = body.get('phone', '').strip()
        code = body.get('code', '').strip()
        
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "SELECT id FROM icq_sms_codes WHERE phone=%s AND code=%s AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
            (phone, code)
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            db.close()
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Неверный или истёкший код'})}
        
        code_id = row[0]
        cur.execute("UPDATE icq_sms_codes SET used=TRUE WHERE id=%s", (code_id,))
        
        # Проверяем, есть ли пользователь
        cur.execute("SELECT id, uin, nickname, first_name, last_name, status, avatar_url FROM icq_users WHERE phone=%s", (phone,))
        user = cur.fetchone()
        is_new = False
        
        if not user:
            # Новый пользователь — генерируем UIN
            uin = generate_uin()
            # Убеждаемся, что UIN уникален
            while True:
                cur.execute("SELECT id FROM icq_users WHERE uin=%s", (uin,))
                if not cur.fetchone():
                    break
                uin = generate_uin()
            
            cur.execute(
                "INSERT INTO icq_users (uin, phone, nickname, status) VALUES (%s, %s, %s, 'online') RETURNING id, uin, nickname, first_name, last_name, status, avatar_url",
                (uin, phone, f'User{uin}')
            )
            user = cur.fetchone()
            is_new = True
        else:
            cur.execute("UPDATE icq_users SET status='online', last_seen=NOW() WHERE id=%s", (user[0],))
        
        token = generate_token()
        expires = datetime.now() + timedelta(days=30)
        cur.execute("INSERT INTO icq_sessions (user_id, token, expires_at) VALUES (%s, %s, %s)", (user[0], token, expires))
        db.commit()
        cur.close()
        db.close()
        
        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'success': True,
                'is_new': is_new,
                'token': token,
                'user': {
                    'id': user[0],
                    'uin': user[1],
                    'nickname': user[2],
                    'first_name': user[3],
                    'last_name': user[4],
                    'status': user[5],
                    'avatar_url': user[6]
                }
            })
        }

    # GET /me — получить профиль
    if method == 'GET' and '/me' in path:
        if not auth_token:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}
        
        db = get_db()
        cur = db.cursor()
        cur.execute(
            "SELECT u.id, u.uin, u.nickname, u.first_name, u.last_name, u.status, u.status_message, u.avatar_url, u.phone FROM icq_sessions s JOIN icq_users u ON s.user_id=u.id WHERE s.token=%s AND s.expires_at > NOW()",
            (auth_token,)
        )
        user = cur.fetchone()
        cur.close()
        db.close()
        
        if not user:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Сессия истекла'})}
        
        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'id': user[0], 'uin': user[1], 'nickname': user[2],
                'first_name': user[3], 'last_name': user[4], 'status': user[5],
                'status_message': user[6], 'avatar_url': user[7], 'phone': user[8]
            })
        }

    # PUT /profile — обновить профиль
    if method == 'PUT' and '/profile' in path:
        if not auth_token:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}
        
        body = json.loads(event.get('body') or '{}')
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT user_id FROM icq_sessions WHERE token=%s AND expires_at > NOW()", (auth_token,))
        session = cur.fetchone()
        if not session:
            cur.close()
            db.close()
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет сессии'})}
        
        user_id = session[0]
        nickname = body.get('nickname', '')
        first_name = body.get('first_name', '')
        last_name = body.get('last_name', '')
        status_message = body.get('status_message', '')
        status = body.get('status', '')
        
        fields = []
        vals = []
        if nickname: fields.append('nickname=%s'); vals.append(nickname)
        if first_name is not None: fields.append('first_name=%s'); vals.append(first_name)
        if last_name is not None: fields.append('last_name=%s'); vals.append(last_name)
        if status_message is not None: fields.append('status_message=%s'); vals.append(status_message)
        if status in ('online', 'away', 'busy', 'invisible', 'offline'): fields.append('status=%s'); vals.append(status)
        
        if fields:
            vals.append(user_id)
            cur.execute(f"UPDATE icq_users SET {', '.join(fields)} WHERE id=%s", vals)
            db.commit()
        
        cur.close()
        db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'success': True})}

    # POST /logout
    if method == 'POST' and '/logout' in path:
        if auth_token:
            db = get_db()
            cur = db.cursor()
            cur.execute("SELECT user_id FROM icq_sessions WHERE token=%s", (auth_token,))
            sess = cur.fetchone()
            if sess:
                cur.execute("UPDATE icq_users SET status='offline' WHERE id=%s", (sess[0],))
            cur.execute("UPDATE icq_sessions SET expires_at=NOW() WHERE token=%s", (auth_token,))
            db.commit()
            cur.close()
            db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'success': True})}

    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}
