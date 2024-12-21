# Streamer Dashboard

A real-time dashboard that tracks streamers across multiple platforms including YouTube, Twitch, and Kick.

## Features

- Multi-platform support (YouTube, Twitch, Kick)
- Real-time status updates
- Profile picture caching
- API key rotation for YouTube
- Admin panel for management

## Deployment

### Prerequisites

- Node.js >= 18.0.0
- npm

### Environment Variables

Create a `.env` file with the following variables:

```env
YOUTUBE_API_KEY_1=your_key_1
YOUTUBE_API_KEY_2=your_key_2
YOUTUBE_API_KEY_3=your_key_3
YOUTUBE_API_KEY_4=your_key_4
YOUTUBE_API_KEY_5=your_key_5
YOUTUBE_API_KEY_6=your_key_6
ADMIN_PASSWORD=your_admin_password
PORT=3000
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_AUTH_TOKEN=your_twitch_auth_token
```

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

### Deployment on Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Use the following settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
4. Add your environment variables in the Render dashboard
5. Deploy!
