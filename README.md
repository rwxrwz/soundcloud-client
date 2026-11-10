<div align="center">

# 🎧 SoundCloud Desktop Player

**Unofficial SoundCloud desktop client for Windows and Linux**

![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-0078D6)
![Version](https://img.shields.io/badge/Version-2.0.0-ff5500)

**English** · [Русский](#-soundcloud-desktop-player-ru)

</div>

---

## ✨ Features

### 📝 Lyrics
- **Synced** - lines highlight as the song plays
- **Sources** - LRCLIB first, Genius if LRCLIB has nothing
- **Local timing** - an AI model on your computer places the timecodes. Free, no key
- **Or Gemini** - needs your own key
- **Manual** - paste the lyrics, or a Genius link if the wrong song was matched
- **Batch check** - shows which tracks in a list have lyrics

### 🎨 Appearance
- **Edit on the player itself** - click a part of the window, its settings open next to it, changes apply at once
- **Themes** - Default, Rain, Sakura, Late Night. Change background, accent and effects in one click
- **Transparent theme** - the window is see-through, the desktop shows behind it
- **Fullscreen** - three layouts, background coloured from the artwork
- **Wallpapers** - your own images or video, with blur
- **Effects** - rain, sakura, night sky
- **New Year** - snow, a tree, a garland. On from 1 December to 14 January
- **Visualizer**

### 📚 Library
- **Search** - tracks, artists, albums, playlists
- **Artist and album pages** - with marks on what you already liked
- **Friends** - who you follow and what they like
- **Playlists** - yours, others', local. Export and import by code
- **Suggestions** - what to add to a playlist you already have
- **Releases** - new tracks from artists you follow
- **Stats** - hours, day streaks, best day, top artists

### 🔊 Sound
- **Equalizer** - 5 bands, presets, shared by code
- **Crossfade** - 0 to 12 seconds
- **Output device** - chosen in the player
- **Download** - the original, or MP3 320
- **DRM** - unavailable tracks are skipped automatically

### 📱 Outside the player
- **Telegram** - your own bot with a Mini App inside it: control the player from your phone. Artwork, lyrics, queue, playlists, SoundCloud search
- **Mini-player** - a separate window on top of the others
- **Media keys** - MPRIS on Linux
- **Discord** - status on your profile: track, artist, artwork, progress bar

### ⚙️ Settings
- **Presets** - save all settings as a code, switch between them
- **Search** - across all three languages, handles a wrong keyboard layout and Russian declension
- **Languages** - English, Russian, Ukrainian
- **Behaviour** - tray, autostart, keep playing similar
- **Updates** - check and read the changelog without leaving the player

---

## 🛠️ Stack

`Electron 32` · `electron-vite` · `React 18` · `TypeScript 5` · `Zustand 5` · `Tailwind CSS 3` · `Web Audio API` · `onnxruntime-node` · `hls.js` · `lamejs` · `ws` · `mpris-service`

Services the player uses on its own: unofficial SoundCloud API v2, LRCLIB, Genius, GitHub (update checks). Only after you enable them: Gemini (your key), Telegram Bot API (your bot), Cloudflare tunnels via `cloudflared` (downloaded on first use), Hugging Face (the timing model).

---

## 🔒 Security and privacy

- Secrets are kept in the OS keychain (Electron `safeStorage`): the SoundCloud, Gemini, Genius and Telegram bot tokens. Written from the main process, never read back.
- Settings, caches and presets are in the OS user-data folder, not next to the binary. Sharing the build does not share your setup.
- Nothing is sent anywhere except the services you turn on. No telemetry, no analytics.
- One shared read-only Genius token ships with the app. It belongs to the app, is the same for everyone, and is there on purpose. A field for your own token appears in settings only if the shared one stops working.
- The remote tunnel runs only while you have it on. The address changes on every launch, the page behind it holds none of your data, and only accounts on your whitelist can control the player.
- The trade-off: traffic to the Mini App goes through Cloudflare servers, where TLS is terminated. The project runs no relay of its own, so this is the one external party involved.
- Hardened Electron: context isolation, no node in web contents, navigation limits, IPC sender and imported file validation.

---

## ℹ️ About unavailable tracks (DRM)

Some SoundCloud tracks are served only as DRM-encrypted streams (Widevine) and will not play in a plain `<audio>` element. The player detects them in advance, marks them in the list and can skip them automatically. This is a SoundCloud limitation.

---

## ⚠️ Disclaimer

Unofficial app, not affiliated with or endorsed by SoundCloud. Works through SoundCloud's private API, so use it at your own risk. Educational, non-commercial.

---
---

<div align="center">

# 🎧 SoundCloud Desktop Player (RU)

**Неофициальный десктоп-клиент SoundCloud для Windows и Linux**

[English](#-soundcloud-desktop-player) · **Русский**

</div>

---

## ✨ Возможности

### 📝 Тексты песен
- **Синхронный текст** - строки подсвечиваются по ходу песни
- **Источники** - сначала LRCLIB, если там нет - Genius
- **Таймкоды локально** - их расставляет AI-модель на твоём компьютере. Бесплатно, без ключа
- **Или через Gemini** - нужен свой ключ
- **Вручную** - можно вставить текст или ссылку на Genius, если нашлась не та песня
- **Проверка списком** - показывает, у каких треков есть текст

### 🎨 Внешний вид
- **Настройка на самом плеере** - кликаешь по части окна, рядом открываются её настройки, изменения применяются сразу
- **Темы** - Default, Rain, Sakura, Late Night. Меняют фон, акцент и эффекты одним кликом
- **Прозрачная тема** - окно полупрозрачное, за ним виден рабочий стол
- **Полный экран** - три раскладки, фон в цветах обложки
- **Обои** - свои картинки или видео, с размытием
- **Эффекты** - дождь, сакура, ночное небо
- **Новый год** - снег, ёлка, гирлянда. С 1 декабря по 14 января
- **Визуализатор**

### 📚 Библиотека
- **Поиск** - треки, артисты, альбомы, плейлисты
- **Страницы артистов и альбомов** - с отметками, что уже в лайках
- **Друзья** - подписки и их лайки
- **Плейлисты** - свои, чужие, локальные. Экспорт и импорт кодом
- **Подбор треков** - что добавить в уже собранный плейлист
- **Релизы** - новое у тех, на кого подписан
- **Статистика** - часы, дни подряд, лучший день, топ артистов

### 🔊 Звук
- **Эквалайзер** - 5 полос, пресеты, обмен кодом
- **Кроссфейд** - от 0 до 12 секунд
- **Устройство вывода** - выбирается в плеере
- **Скачивание** - оригинал или MP3 320
- **DRM** - недоступные треки пропускаются автоматически

### 📱 Вне плеера
- **Telegram** - свой бот и мини-приложение в нём: управляешь плеером с телефона. Обложка, текст, очередь, плейлисты, поиск по SoundCloud
- **Мини-плеер** - отдельное окно поверх остальных
- **Медиа-клавиши** - на Linux через MPRIS
- **Discord** - статус в профиле: трек, исполнитель, обложка, прогресс бар

### ⚙️ Настройки
- **Пресеты** - сохранить все настройки кодом и переключаться между ними
- **Поиск** - сразу по трём языкам, понимает неверную раскладку и склонения
- **Языки** - русский, английский, украинский
- **Поведение** - трей, автозапуск, продолжение похожими
- **Обновления** - проверка и список изменений прямо в плеере

---

## 🛠️ Стек

`Electron 32` · `electron-vite` · `React 18` · `TypeScript 5` · `Zustand 5` · `Tailwind CSS 3` · `Web Audio API` · `onnxruntime-node` · `hls.js` · `lamejs` · `ws` · `mpris-service`

Сервисы, которые плеер использует сам: неофициальный SoundCloud API v2, LRCLIB, Genius, GitHub (проверка обновлений). Только после включения: Gemini (твой ключ), Telegram Bot API (твой бот), туннели Cloudflare через `cloudflared` (скачивается при первом включении), Hugging Face (модель для таймкодов).

---

## 🔒 Безопасность и приватность

- Секреты хранятся в системной связке ключей (Electron `safeStorage`): токены SoundCloud, Gemini, Genius и Telegram-бота. Записываются из главного процесса, обратно не читаются.
- Настройки, кэш и пресеты лежат в пользовательской папке ОС, а не рядом с бинарником. Передав сборку, ты не передаёшь свои настройки.
- Никуда ничего не отправляется, кроме включённых тобой сервисов. Ни телеметрии, ни аналитики.
- В сборку входит общий read-only токен Genius. Он принадлежит приложению, одинаков у всех и добавлен намеренно. Поле для своего токена появляется в настройках, только если общий перестал работать.
- Туннель для удалённого доступа работает только пока включён. Адрес меняется при каждом запуске, на странице по нему нет твоих данных, а управлять плеером могут только аккаунты из белого списка.
- Компромисс: трафик до мини-приложения идёт через серверы Cloudflare, где расшифровывается TLS. Своего сервера-посредника у проекта нет, поэтому это единственная внешняя сторона.
- Усиленная конфигурация Electron: изоляция контекста, node отключён в веб-контентах, ограничена навигация, проверяются отправители IPC и импортируемые файлы.

---

## ℹ️ Про недоступные треки (DRM)

Часть треков SoundCloud отдаёт только в зашифрованном виде (DRM, Widevine), в обычном `<audio>` они не воспроизводятся. Плеер определяет их заранее, помечает в списке и может пропускать автоматически. Это ограничение SoundCloud.

---

## ⚠️ Дисклеймер

Неофициальное приложение, не связано с SoundCloud и не одобрено им. Работает через закрытый API SoundCloud, используйте на свой страх и риск. В учебных целях, без коммерческого использования.
