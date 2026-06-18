"""
ICQ Contacts: список контактов, добавление по UIN, поиск пользователей.
"""
import json
import os
import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-User-Id',
}

def get_db():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def get_user_by_token(cur, token):
    cur.execute(
        "SELECT u.id, u.uin FROM icq_sessions s JOIN icq_users u ON s.user_id=u.id WHERE s.token=%s AND s.expires_at > NOW()",
        (token,)
    )
    return cur.fetchone()

def handler(event: dict, context) -> dict:
    """Контакты ICQ: список, добавление, удаление, поиск по UIN"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')
    headers_in = event.get('headers', {})
    token = headers_in.get('X-Auth-Token') or headers_in.get('x-auth-token', '')

    if not token:
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Нет токена'})}

    db = get_db()
    cur = db.cursor()
    me = get_user_by_token(cur, token)
    if not me:
        cur.close()
        db.close()
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Сессия истекла'})}
    
    my_id = me[0]

    # GET /contacts — список контактов
    if method == 'GET' and path.rstrip('/').endswith('/contacts'):
        cur.execute("""
            SELECT c.id, c.nickname, c.group_name,
                   u.id, u.uin, u.nickname, u.first_name, u.last_name, u.status, u.status_message, u.avatar_url, u.last_seen
            FROM icq_contacts c
            JOIN icq_users u ON c.contact_id = u.id
            WHERE c.owner_id = %s
            ORDER BY u.status, u.nickname
        """, (my_id,))
        rows = cur.fetchall()
        contacts = []
        for r in rows:
            contacts.append({
                'contact_row_id': r[0],
                'my_nickname': r[1],
                'group': r[2],
                'user': {
                    'id': r[3], 'uin': r[4], 'nickname': r[5],
                    'first_name': r[6], 'last_name': r[7], 'status': r[8],
                    'status_message': r[9], 'avatar_url': r[10],
                    'last_seen': r[11].isoformat() if r[11] else None
                }
            })
        cur.close()
        db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'contacts': contacts})}

    # POST /contacts — добавить контакт по UIN
    if method == 'POST' and path.rstrip('/').endswith('/contacts'):
        body = json.loads(event.get('body') or '{}')
        uin = body.get('uin')
        if not uin:
            cur.close()
            db.close()
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Укажите UIN'})}
        
        cur.execute("SELECT id, uin, nickname, first_name, last_name, status, avatar_url FROM icq_users WHERE uin=%s", (int(uin),))
        target = cur.fetchone()
        if not target:
            cur.close()
            db.close()
            return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': f'Пользователь с UIN {uin} не найден'})}
        
        if target[0] == my_id:
            cur.close()
            db.close()
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нельзя добавить себя'})}
        
        try:
            cur.execute(
                "INSERT INTO icq_contacts (owner_id, contact_id, nickname, group_name) VALUES (%s, %s, %s, %s)",
                (my_id, target[0], body.get('nickname', target[2]), body.get('group', 'Общие'))
            )
            db.commit()
        except psycopg2.errors.UniqueViolation:
            db.rollback()
            cur.close()
            db.close()
            return {'statusCode': 409, 'headers': CORS, 'body': json.dumps({'error': 'Контакт уже добавлен'})}
        
        cur.close()
        db.close()
        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'success': True,
                'user': {'id': target[0], 'uin': target[1], 'nickname': target[2], 'status': target[5]}
            })
        }

    # DELETE /contacts/{id}
    if method == 'DELETE' and '/contacts/' in path:
        contact_row_id = path.split('/')[-1]
        cur.execute("DELETE FROM icq_contacts WHERE id=%s AND owner_id=%s", (contact_row_id, my_id))
        db.commit()
        cur.close()
        db.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'success': True})}

    # GET /search?uin=123456789
    if method == 'GET' and '/search' in path:
        params = event.get('queryStringParameters') or {}
        uin = params.get('uin', '')
        if not uin:
            cur.close()
            db.close()
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Укажите UIN для поиска'})}
        
        cur.execute(
            "SELECT id, uin, nickname, first_name, last_name, status, avatar_url FROM icq_users WHERE uin=%s",
            (int(uin),)
        )
        user = cur.fetchone()
        cur.close()
        db.close()
        
        if not user:
            return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Пользователь не найден'})}
        
        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'id': user[0], 'uin': user[1], 'nickname': user[2],
                'first_name': user[3], 'last_name': user[4], 'status': user[5], 'avatar_url': user[6]
            })
        }

    cur.close()
    db.close()
    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}
