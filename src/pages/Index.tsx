import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '@/components/ui/icon';

const AUTH_URL = 'https://functions.poehali.dev/e32fdd23-017b-4fb1-9618-d70e0b0977d0';
const CONTACTS_URL = 'https://functions.poehali.dev/41293e94-7f98-4dba-924c-a66e6ba9b743';
const MESSAGES_URL = 'https://functions.poehali.dev/9a12c763-6693-4c21-90b4-f402eb6635ae';

type Status = 'online' | 'away' | 'busy' | 'invisible' | 'offline';

interface User {
  id: number;
  uin: number;
  nickname: string;
  first_name: string;
  last_name: string;
  status: Status;
  status_message: string;
  avatar_url: string;
  phone?: string;
}

interface Contact {
  contact_row_id: number;
  my_nickname: string;
  group: string;
  user: User;
}

interface Message {
  id: number;
  sender_id: number;
  content: string;
  sent_at: string;
  is_mine: boolean;
  sender_nickname: string;
}

interface Dialog {
  user: User;
  last_message: string;
  last_time: string;
  is_mine: boolean;
  unread: number;
}

const STATUS_COLORS: Record<Status, string> = {
  online: '#4caf50',
  away: '#ffc107',
  busy: '#e53935',
  invisible: '#9e9e9e',
  offline: '#9e9e9e',
};

const STATUS_LABELS: Record<Status, string> = {
  online: 'В сети',
  away: 'Отошёл',
  busy: 'Занят',
  invisible: 'Невидимка',
  offline: 'Не в сети',
};

const STATUS_ICONS: Record<Status, string> = {
  online: '🟢',
  away: '🟡',
  busy: '🔴',
  invisible: '⚫',
  offline: '⚫',
};

function ICQFlower({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="18" r="10" fill="#4CAF50" opacity="0.9" />
      <circle cx="46" cy="26" r="10" fill="#8BC34A" opacity="0.9" />
      <circle cx="46" cy="42" r="10" fill="#FFEB3B" opacity="0.9" />
      <circle cx="32" cy="50" r="10" fill="#FF9800" opacity="0.9" />
      <circle cx="18" cy="42" r="10" fill="#F44336" opacity="0.9" />
      <circle cx="18" cy="26" r="10" fill="#9C27B0" opacity="0.9" />
      <circle cx="32" cy="32" r="12" fill="white" />
      <text x="32" y="37" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1c5a8a">ICQ</text>
    </svg>
  );
}

function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const initials = (user.nickname || user.first_name || 'U').charAt(0).toUpperCase();
  const colors = ['#2878c0', '#4caf50', '#ff9800', '#9c27b0', '#e53935', '#00bcd4'];
  const color = colors[user.uin % colors.length];

  if (user.avatar_url) {
    return (
      <div style={{ width: size, height: size, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
        <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: 4, background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'white', fontSize: size * 0.4, fontWeight: 700, flexShrink: 0
    }}>
      {initials}
    </div>
  );
}

function StatusDot({ status, size = 10 }: { status: Status; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: STATUS_COLORS[status],
      border: '1.5px solid white',
      flexShrink: 0,
    }} />
  );
}

function formatTime(isoStr: string) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

// ─── Login Screen ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [step, setStep] = useState<'phone' | 'code' | 'profile'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoCode, setDemoCode] = useState('');
  const [token, setToken] = useState('');
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [isNew, setIsNew] = useState(false);

  async function sendCode() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${AUTH_URL}/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const d = await r.json();
      if (!d.success) { setError(d.error || 'Ошибка'); return; }
      if (d.demo) setDemoCode(d.code);
      setStep('code');
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${AUTH_URL}/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const d = await r.json();
      if (!d.success) { setError(d.error || 'Неверный код'); return; }
      setToken(d.token);
      setPendingUser(d.user);
      setIsNew(d.is_new);
      if (d.is_new) {
        setNickname('');
        setStep('profile');
      } else {
        onLogin(d.token, d.user);
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    if (!nickname.trim()) { setError('Введи никнейм'); return; }
    setLoading(true);
    try {
      await fetch(`${AUTH_URL}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
      onLogin(token, { ...pendingUser!, nickname: nickname.trim() });
    } catch {
      setError('Ошибка');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a4a7a 0%, #2878c0 40%, #1c5a8a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Rubik', 'Tahoma', sans-serif",
    }}>
      {/* Background pattern */}
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.04,
        backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        pointerEvents: 'none',
      }} />

      <div className="animate-scale-in" style={{
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        width: 360,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(180deg, #3a8fd4 0%, #1c5a8a 100%)',
          padding: '24px 20px 20px',
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <ICQFlower size={56} />
          </div>
          <div style={{ color: 'white', fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>ICQ</div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 }}>I Seek You</div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 24px 28px' }}>
          {step === 'phone' && (
            <div className="animate-fade-in">
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1c5a8a', marginBottom: 16 }}>
                Вход в ICQ
              </div>
              <label style={{ fontSize: 11, color: '#6a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Номер телефона
              </label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+7 999 123-45-67"
                onKeyDown={e => e.key === 'Enter' && sendCode()}
                style={inputStyle}
              />
              {error && <div style={errorStyle}>{error}</div>}
              <button onClick={sendCode} disabled={loading || !phone} style={btnStyle(loading || !phone)}>
                {loading ? 'Отправляем...' : 'Получить код →'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 16, color: '#8a9ab0', fontSize: 12 }}>
                Введи номер — пришлём код подтверждения
              </div>
            </div>
          )}

          {step === 'code' && (
            <div className="animate-fade-in">
              <button onClick={() => setStep('phone')} style={{ background: 'none', border: 'none', color: '#2878c0', cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 12 }}>
                ← Изменить номер
              </button>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1c5a8a', marginBottom: 4 }}>
                Введи код
              </div>
              <div style={{ fontSize: 12, color: '#6a7a8a', marginBottom: 16 }}>
                Отправили на {phone}
              </div>
              {demoCode && (
                <div style={{
                  background: '#fffde7', border: '1px solid #ffc107', borderRadius: 4,
                  padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#8a6d00'
                }}>
                  🔑 Демо-режим. Твой код: <strong style={{ fontSize: 18, letterSpacing: 3 }}>{demoCode}</strong>
                </div>
              )}
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="_ _ _ _ _ _"
                maxLength={6}
                onKeyDown={e => e.key === 'Enter' && verifyCode()}
                style={{ ...inputStyle, fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
              />
              {error && <div style={errorStyle}>{error}</div>}
              <button onClick={verifyCode} disabled={loading || code.length < 4} style={btnStyle(loading || code.length < 4)}>
                {loading ? 'Проверяем...' : 'Войти'}
              </button>
            </div>
          )}

          {step === 'profile' && (
            <div className="animate-fade-in">
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1c5a8a', marginBottom: 4 }}>
                Добро пожаловать! 🎉
              </div>
              <div style={{ fontSize: 12, color: '#6a7a8a', marginBottom: 16 }}>
                Придумай никнейм для своего аккаунта
              </div>
              <div style={{
                background: 'linear-gradient(135deg, #e8f4fd, #d0e8f8)',
                border: '1px solid #b0d0f0',
                borderRadius: 4, padding: '10px 14px', marginBottom: 16,
                fontSize: 12, color: '#1c5a8a'
              }}>
                🔢 Твой UIN: <strong style={{ fontSize: 16, letterSpacing: 1 }}>{pendingUser?.uin}</strong>
                <br /><span style={{ color: '#6a7a8a', fontSize: 11 }}>Запомни — это твой ICQ-номер</span>
              </div>
              <label style={{ fontSize: 11, color: '#6a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Никнейм
              </label>
              <input
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="CoolUser2010"
                onKeyDown={e => e.key === 'Enter' && saveProfile()}
                style={inputStyle}
                autoFocus
              />
              {error && <div style={errorStyle}>{error}</div>}
              <button onClick={saveProfile} disabled={loading || !nickname.trim()} style={btnStyle(loading || !nickname.trim())}>
                {loading ? 'Сохраняем...' : 'Начать общение →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid #b0c8e0', borderRadius: 3,
  padding: '9px 12px', fontSize: 13, marginTop: 6, marginBottom: 4,
  outline: 'none', boxSizing: 'border-box', background: '#f8fbff',
  fontFamily: "'Rubik', 'Tahoma', sans-serif",
  transition: 'border-color 0.2s',
};

const errorStyle: React.CSSProperties = {
  color: '#e53935', fontSize: 12, marginBottom: 8, padding: '4px 0'
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%', padding: '10px', borderRadius: 3, border: 'none',
  background: disabled ? '#b0c8e0' : 'linear-gradient(180deg, #5aabf0 0%, #2878c0 100%)',
  color: 'white', fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
  marginTop: 8, transition: 'all 0.2s', fontFamily: "'Rubik', 'Tahoma', sans-serif",
  boxShadow: disabled ? 'none' : '0 2px 8px rgba(40,120,192,0.4)',
});

// ─── Contact List Window ─────────────────────────────────────────────────────
function ContactListWindow({
  me, contacts, dialogs, token, onChat, onLogout, onRefreshContacts
}: {
  me: User;
  contacts: Contact[];
  dialogs: Dialog[];
  token: string;
  onChat: (user: User) => void;
  onLogout: () => void;
  onRefreshContacts: () => void;
}) {
  const [tab, setTab] = useState<'contacts' | 'dialogs'>('contacts');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [addUin, setAddUin] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [myStatus, setMyStatus] = useState<Status>(me.status);
  const [searchResult, setSearchResult] = useState<User | null>(null);

  const groups = contacts.reduce((acc, c) => {
    const g = c.group || 'Общие';
    if (!acc[g]) acc[g] = [];
    acc[g].push(c);
    return acc;
  }, {} as Record<string, Contact[]>);

  async function changeStatus(status: Status) {
    setMyStatus(status);
    setShowStatusMenu(false);
    await fetch(`${AUTH_URL}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify({ status }),
    });
  }

  async function searchUser() {
    setAddError('');
    setSearchResult(null);
    if (!addUin.trim()) return;
    try {
      const r = await fetch(`${CONTACTS_URL}/search?uin=${addUin}`, {
        headers: { 'X-Auth-Token': token }
      });
      const d = await r.json();
      if (r.ok) setSearchResult(d);
      else setAddError(d.error || 'Не найден');
    } catch { setAddError('Ошибка сети'); }
  }

  async function addContact(user: User) {
    setAddLoading(true);
    setAddError('');
    try {
      const r = await fetch(`${CONTACTS_URL}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body: JSON.stringify({ uin: user.uin }),
      });
      const d = await r.json();
      if (d.success) {
        setShowAddContact(false);
        setAddUin('');
        setSearchResult(null);
        onRefreshContacts();
      } else {
        setAddError(d.error || 'Ошибка');
      }
    } catch { setAddError('Ошибка сети'); }
    finally { setAddLoading(false); }
  }

  const totalUnread = dialogs.reduce((s, d) => s + d.unread, 0);

  return (
    <div style={{
      width: 260, minHeight: '100vh', maxHeight: '100vh',
      background: '#ecf3fa',
      border: '1px solid #8ab0d0',
      display: 'flex', flexDirection: 'column',
      boxShadow: '2px 0 12px rgba(0,0,0,0.15)',
      fontFamily: "'Rubik', 'Tahoma', sans-serif",
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(180deg, #3a8fd4 0%, #1c5a8a 100%)',
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <ICQFlower size={28} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>ICQ</div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>I Seek You</div>
        </div>
        <button onClick={onLogout} title="Выход" style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer', padding: 4, borderRadius: 3,
        }}>
          <Icon name="LogOut" size={16} />
        </button>
      </div>

      {/* My profile strip */}
      <div style={{
        background: 'linear-gradient(180deg, #2878c0 0%, #1c5a8a 100%)',
        padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ position: 'relative' }}>
          <Avatar user={me} size={32} />
          <div style={{ position: 'absolute', bottom: -2, right: -2 }}>
            <StatusDot status={myStatus} size={10} />
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ color: 'white', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {me.nickname}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10 }}>
            UIN: {me.uin}
          </div>
        </div>
        <button
          onClick={() => setShowStatusMenu(!showStatusMenu)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', padding: 4 }}
        >
          <span style={{ fontSize: 14 }}>{STATUS_ICONS[myStatus]}</span>
          {showStatusMenu && (
            <div style={{
              position: 'absolute', right: 0, top: 26, background: 'white',
              border: '1px solid #b0c8e0', borderRadius: 4, zIndex: 100,
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)', minWidth: 130,
            }}>
              {(Object.keys(STATUS_LABELS) as Status[]).map(s => (
                <button key={s} onClick={() => changeStatus(s)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 12px', background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 12, textAlign: 'left',
                  color: '#1c3a5a',
                  ...(s === myStatus ? { background: '#e8f4fd' } : {}),
                }}>
                  <span>{STATUS_ICONS[s]}</span> {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#d4e0ec', borderBottom: '1px solid #b0c8e0' }}>
        {[
          { key: 'contacts', label: 'Контакты', icon: 'Users' },
          { key: 'dialogs', label: 'Сообщения', icon: 'MessageSquare', badge: totalUnread },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as 'contacts' | 'dialogs')}
            style={{
              flex: 1, padding: '7px 4px', border: 'none',
              background: tab === t.key ? '#ecf3fa' : 'transparent',
              borderBottom: tab === t.key ? '2px solid #2878c0' : '2px solid transparent',
              cursor: 'pointer', fontSize: 11, color: tab === t.key ? '#1c5a8a' : '#6a7a8a',
              fontWeight: tab === t.key ? 600 : 400,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
            {t.badge ? (
              <span style={{
                background: '#e53935', color: 'white', borderRadius: 8,
                fontSize: 10, padding: '1px 5px', fontWeight: 700
              }}>{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'contacts' && (
          <div>
            {Object.keys(groups).length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#6a7a8a', fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                Список контактов пуст.<br />Добавь первый контакт!
              </div>
            ) : (
              Object.entries(groups).map(([group, cs]) => (
                <div key={group}>
                  <div style={{
                    background: '#d0dcec', padding: '4px 10px',
                    fontSize: 11, color: '#4a6a8a', fontWeight: 600,
                    borderTop: '1px solid #b0c8e0', borderBottom: '1px solid #b0c8e0',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    {group} ({cs.length})
                  </div>
                  {cs.map(c => (
                    <ContactItem key={c.contact_row_id} contact={c} onClick={() => onChat(c.user)} />
                  ))}
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'dialogs' && (
          <div>
            {dialogs.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#6a7a8a', fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                Нет диалогов.<br />Начни общаться!
              </div>
            ) : (
              dialogs.map(d => (
                <DialogItem key={d.user.id} dialog={d} onClick={() => onChat(d.user)} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div style={{
        background: 'linear-gradient(180deg, #d4e0ec 0%, #c0d0e4 100%)',
        borderTop: '1px solid #b0c8e0',
        display: 'flex', gap: 4, padding: '6px 8px',
      }}>
        <ToolBtn icon="UserPlus" title="Добавить контакт" onClick={() => setShowAddContact(true)} />
        <ToolBtn icon="Search" title="Найти пользователя" onClick={() => setShowAddContact(true)} />
        <ToolBtn icon="Settings" title="Настройки" onClick={() => {}} />
      </div>

      {/* Add Contact Modal */}
      {showAddContact && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200
        }} onClick={e => { if (e.target === e.currentTarget) { setShowAddContact(false); setSearchResult(null); setAddUin(''); setAddError(''); }}}>
          <div className="animate-scale-in" style={{
            background: 'white', borderRadius: 6, width: 320,
            border: '1px solid #8ab0d0', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            overflow: 'hidden',
          }}>
            <div style={{
              background: 'linear-gradient(180deg, #3a8fd4 0%, #1c5a8a 100%)',
              padding: '10px 16px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Добавить контакт</span>
              <button onClick={() => { setShowAddContact(false); setSearchResult(null); setAddUin(''); setAddError(''); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <Icon name="X" size={16} />
              </button>
            </div>
            <div style={{ padding: 16 }}>
              <label style={{ fontSize: 11, color: '#6a7a8a', fontWeight: 600, textTransform: 'uppercase' }}>
                UIN пользователя
              </label>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  value={addUin}
                  onChange={e => { setAddUin(e.target.value.replace(/\D/g, '')); setSearchResult(null); }}
                  placeholder="123456789"
                  onKeyDown={e => e.key === 'Enter' && searchUser()}
                  style={{ ...inputStyle, margin: 0, flex: 1 }}
                />
                <button onClick={searchUser} style={{
                  ...btnStyle(false), width: 'auto', padding: '9px 14px', margin: 0, fontSize: 12
                }}>Найти</button>
              </div>
              {addError && <div style={errorStyle}>{addError}</div>}

              {searchResult && (
                <div className="animate-fade-in" style={{
                  marginTop: 12, border: '1px solid #b0d0f0', borderRadius: 4,
                  background: '#f0f8ff', padding: '10px 12px',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Avatar user={searchResult} size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1c3a5a' }}>{searchResult.nickname}</div>
                    <div style={{ fontSize: 11, color: '#6a7a8a' }}>UIN: {searchResult.uin}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <StatusDot status={searchResult.status as Status} size={8} />
                      <span style={{ fontSize: 11, color: '#6a7a8a' }}>{STATUS_LABELS[searchResult.status as Status]}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => addContact(searchResult)}
                    disabled={addLoading}
                    style={{ ...btnStyle(addLoading), width: 'auto', padding: '7px 14px', margin: 0, fontSize: 12 }}
                  >
                    {addLoading ? '...' : 'Добавить'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactItem({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  const u = contact.user;
  const isOnline = u.status === 'online';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', cursor: 'pointer',
        borderBottom: '1px solid rgba(176,200,224,0.3)',
        opacity: isOnline ? 1 : 0.65,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#dceaf8')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ position: 'relative' }}>
        <Avatar user={u} size={30} />
        <div style={{ position: 'absolute', bottom: -2, right: -2 }}>
          <StatusDot status={u.status as Status} size={9} />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1c3a5a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {contact.my_nickname || u.nickname}
        </div>
        {u.status_message && (
          <div style={{ fontSize: 10, color: '#6a7a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {u.status_message}
          </div>
        )}
      </div>
    </div>
  );
}

function DialogItem({ dialog, onClick }: { dialog: Dialog; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', cursor: 'pointer',
        borderBottom: '1px solid rgba(176,200,224,0.3)',
        background: dialog.unread > 0 ? 'rgba(40,120,192,0.06)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#dceaf8')}
      onMouseLeave={e => (e.currentTarget.style.background = dialog.unread > 0 ? 'rgba(40,120,192,0.06)' : 'transparent')}
    >
      <div style={{ position: 'relative' }}>
        <Avatar user={dialog.user} size={32} />
        <div style={{ position: 'absolute', bottom: -2, right: -2 }}>
          <StatusDot status={dialog.user.status as Status} size={9} />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1c3a5a' }}>{dialog.user.nickname}</span>
          <span style={{ fontSize: 10, color: '#8a9ab0' }}>{formatTime(dialog.last_time)}</span>
        </div>
        <div style={{ fontSize: 11, color: '#6a7a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {dialog.is_mine ? 'Вы: ' : ''}{dialog.last_message}
        </div>
      </div>
      {dialog.unread > 0 && (
        <span style={{
          background: '#e53935', color: 'white', borderRadius: 8,
          fontSize: 10, padding: '2px 6px', fontWeight: 700, flexShrink: 0
        }}>{dialog.unread}</span>
      )}
    </div>
  );
}

function ToolBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        flex: 1, padding: '6px', border: '1px solid #a0b8d0', borderRadius: 3,
        background: 'linear-gradient(180deg, #e8f2fa 0%, #d0e0f0 100%)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#1c5a8a',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'linear-gradient(180deg, #f0f8ff 0%, #dceaf8 100%)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'linear-gradient(180deg, #e8f2fa 0%, #d0e0f0 100%)')}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

// ─── Chat Window ─────────────────────────────────────────────────────────────
function ChatWindow({ me, peer, token, onClose }: { me: User; peer: User; token: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      const r = await fetch(`${MESSAGES_URL}/history?with=${peer.id}&limit=50`, {
        headers: { 'X-Auth-Token': token }
      });
      const d = await r.json();
      if (d.messages) setMessages(d.messages);
    } finally {
      setLoading(false);
    }
  }, [peer.id, token]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      const r = await fetch(`${MESSAGES_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body: JSON.stringify({ to_id: peer.id, content: text }),
      });
      const d = await r.json();
      if (d.success) {
        setMessages(prev => [...prev, d.message]);
      }
    } finally {
      setSending(false);
    }
  }

  const groupedMessages = messages.reduce((acc, msg) => {
    const date = new Date(msg.sent_at).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
    if (!acc[date]) acc[date] = [];
    acc[date].push(msg);
    return acc;
  }, {} as Record<string, Message[]>);

  return (
    <div className="animate-slide-in-right" style={{
      display: 'flex', flexDirection: 'column',
      flex: 1, minHeight: '100vh', maxHeight: '100vh',
      background: '#f4f8fc',
      fontFamily: "'Rubik', 'Tahoma', sans-serif",
    }}>
      {/* Chat Header */}
      <div style={{
        background: 'linear-gradient(180deg, #3a8fd4 0%, #1c5a8a 100%)',
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        flexShrink: 0,
      }}>
        <div style={{ position: 'relative' }}>
          <Avatar user={peer} size={36} />
          <div style={{ position: 'absolute', bottom: -2, right: -2 }}>
            <StatusDot status={peer.status as Status} size={11} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>{peer.nickname}</div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
            {STATUS_LABELS[peer.status as Status]} · UIN: {peer.uin}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)',
          cursor: 'pointer', padding: 6, borderRadius: 3,
        }}>
          <Icon name="X" size={18} />
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#6a7a8a', marginTop: 40 }}>
            <div className="animate-status-pulse">Загружаем историю...</div>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8a9ab0', marginTop: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 13 }}>Начните общение с {peer.nickname}!</div>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              <div style={{
                textAlign: 'center', margin: '12px 0',
                fontSize: 11, color: '#8a9ab0',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ flex: 1, height: 1, background: '#d0dce8' }} />
                {date}
                <div style={{ flex: 1, height: 1, background: '#d0dce8' }} />
              </div>
              {msgs.map((msg, i) => (
                <MessageBubble key={msg.id} msg={msg} prevMsg={msgs[i - 1]} me={me} peer={peer} />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        background: 'white', borderTop: '1px solid #c8d8e8',
        padding: '10px 14px',
        flexShrink: 0,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={`Написать ${peer.nickname}...`}
            rows={2}
            style={{
              flex: 1, border: '1px solid #b0c8e0', borderRadius: 4,
              padding: '8px 12px', fontSize: 13, resize: 'none',
              fontFamily: "'Rubik', 'Tahoma', sans-serif",
              outline: 'none', background: '#f8fbff',
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            style={{
              ...btnStyle(!input.trim() || sending),
              width: 44, height: 44, padding: 0, margin: 0,
              borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="Send" size={18} />
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#a0b0c0', marginTop: 4 }}>
          Enter — отправить · Shift+Enter — новая строка
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, prevMsg, me, peer }: { msg: Message; prevMsg?: Message; me: User; peer: User }) {
  const isMine = msg.is_mine;
  const showAvatar = !prevMsg || prevMsg.is_mine !== msg.is_mine;
  const time = new Date(msg.sent_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="animate-message-pop" style={{
      display: 'flex',
      flexDirection: isMine ? 'row-reverse' : 'row',
      gap: 8,
      marginBottom: showAvatar ? 10 : 3,
      alignItems: 'flex-end',
    }}>
      <div style={{ width: 28, flexShrink: 0 }}>
        {showAvatar && <Avatar user={isMine ? me : peer} size={28} />}
      </div>
      <div style={{ maxWidth: '70%' }}>
        {showAvatar && (
          <div style={{
            fontSize: 10, color: '#8a9ab0', marginBottom: 2,
            textAlign: isMine ? 'right' : 'left', paddingLeft: isMine ? 0 : 4, paddingRight: isMine ? 4 : 0,
          }}>
            {isMine ? 'Вы' : peer.nickname}
          </div>
        )}
        <div style={{
          background: isMine
            ? 'linear-gradient(135deg, #3a8fd4, #2878c0)'
            : 'white',
          color: isMine ? 'white' : '#1c3a5a',
          borderRadius: isMine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
          padding: '8px 12px',
          fontSize: 13,
          lineHeight: 1.5,
          border: isMine ? 'none' : '1px solid #d0dce8',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}>
          {msg.content}
        </div>
        <div style={{
          fontSize: 10, color: '#a0b0c0', marginTop: 2,
          textAlign: isMine ? 'right' : 'left',
          paddingLeft: isMine ? 0 : 4, paddingRight: isMine ? 4 : 0,
        }}>
          {time} {isMine && (msg.is_read ? '✓✓' : '✓')}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Index() {
  const [token, setToken] = useState(() => localStorage.getItem('icq_token') || '');
  const [me, setMe] = useState<User | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [activePeer, setActivePeer] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!token) { setAuthLoading(false); return; }
    fetch(`${AUTH_URL}/me`, { headers: { 'X-Auth-Token': token } })
      .then(r => r.json())
      .then(d => {
        if (d.id) setMe(d);
        else { setToken(''); localStorage.removeItem('icq_token'); }
      })
      .catch(() => { setToken(''); localStorage.removeItem('icq_token'); })
      .finally(() => setAuthLoading(false));
  }, [token]);

  const loadContacts = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${CONTACTS_URL}/contacts`, { headers: { 'X-Auth-Token': token } });
    const d = await r.json();
    if (d.contacts) setContacts(d.contacts);
  }, [token]);

  const loadDialogs = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${MESSAGES_URL}/dialogs`, { headers: { 'X-Auth-Token': token } });
    const d = await r.json();
    if (d.dialogs) setDialogs(d.dialogs);
  }, [token]);

  useEffect(() => {
    if (!me) return;
    loadContacts();
    loadDialogs();
    const interval = setInterval(() => { loadContacts(); loadDialogs(); }, 5000);
    return () => clearInterval(interval);
  }, [me, loadContacts, loadDialogs]);

  function handleLogin(t: string, user: User) {
    setToken(t);
    localStorage.setItem('icq_token', t);
    setMe(user);
  }

  async function handleLogout() {
    await fetch(`${AUTH_URL}/logout`, {
      method: 'POST',
      headers: { 'X-Auth-Token': token }
    });
    localStorage.removeItem('icq_token');
    setToken('');
    setMe(null);
    setContacts([]);
    setDialogs([]);
    setActivePeer(null);
  }

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh', background: 'linear-gradient(135deg, #1a4a7a 0%, #2878c0 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16
      }}>
        <ICQFlower size={64} />
        <div className="animate-status-pulse" style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
          Загружаем ICQ...
        </div>
      </div>
    );
  }

  if (!token || !me) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div style={{
      display: 'flex', minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a3a6a 0%, #2878c0 100%)',
      fontFamily: "'Rubik', 'Tahoma', sans-serif",
    }}>
      <ContactListWindow
        me={me}
        contacts={contacts}
        dialogs={dialogs}
        token={token}
        onChat={setActivePeer}
        onLogout={handleLogout}
        onRefreshContacts={loadContacts}
      />
      {activePeer ? (
        <ChatWindow
          key={activePeer.id}
          me={me}
          peer={activePeer}
          token={token}
          onClose={() => setActivePeer(null)}
        />
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 16, color: 'rgba(255,255,255,0.7)',
        }}>
          <ICQFlower size={80} />
          <div style={{ fontSize: 22, fontWeight: 700, color: 'white' }}>ICQ</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)' }}>Выбери контакт для общения</div>
          <div style={{
            marginTop: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 8,
            padding: '10px 20px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}>
            Твой UIN: <strong style={{ color: 'white', letterSpacing: 1 }}>{me.uin}</strong>
          </div>
        </div>
      )}
    </div>
  );
}