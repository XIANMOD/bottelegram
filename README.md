# COMBO AI Affiliate Bot — MVP

Starter Telegram bot that:
- accepts a product photo,
- asks Groq to analyze it and propose 5 distinct video concepts,
- lets the user choose one concept,
- sends the photo + prompt to fal.ai image-to-video,
- supports text-to-video via `/textvideo`,
- sends the generated MP4 back to Telegram.

## Important MVP limitations
- This is a technical prototype, not yet a paid production service.
- No credit/payment system or Supabase database is included yet.
- User state is held in memory; restarting the service clears pending photo/prompt choices.
- Every successful generation may incur fal.ai charges. Test with a single generation first.
- Review generated video, product details, and any marketing claims before publishing.
- Image-to-video output aspect ratio depends on the selected model/input. FFmpeg is installed, but vertical formatting and subtitles are not yet wired in.

## Local setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Fill `TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, and `FAL_KEY`.
4. Run:
   ```bash
   npm install
   npm start
   ```

## Railway setup
1. Create a new Railway project and deploy this folder from a GitHub repository, or upload the project using your preferred Git workflow.
2. In Railway → service → Variables, add:
   - `TELEGRAM_BOT_TOKEN`
   - `GROQ_API_KEY`
   - `FAL_KEY`
3. Optional variables have defaults, so they do not need to be added unless you want to change models.
4. Deploy and inspect logs.

Do not paste API keys into source code, GitHub, screenshots, or chat messages.

## Bot commands
- `/start` — show menu
- `/textvideo` — start text-to-video mode
- `/cancel` — cancel the current pending action

## API references
- fal.ai Ovi image-to-video: https://fal.ai/models/fal-ai/ovi/image-to-video/api
- fal.ai Ovi text-to-video: https://fal.ai/models/fal-ai/ovi/api
- Groq vision models: https://console.groq.com/docs/vision
- Groq deprecations: https://console.groq.com/docs/deprecations
