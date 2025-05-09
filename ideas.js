// ideas.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const OpenAI = require('openai');

// Load environment variables
const {
    YOUTUBE_API_KEY,
    OPENAI_API_KEY,
    GOOGLE_SHEET_ID,
    GOOGLE_SHEET_NAME,
} = process.env;

// Initialize OpenAI API
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Authenticate with Google Sheets API
async function authenticateGoogleSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// Fetch existing video IDs to prevent duplicates
async function fetchExistingVideoIds(sheets) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${GOOGLE_SHEET_NAME}!A2:A`,
        });

        const rows = response.data.values || [];
        return new Set(rows.map((row) => row[0]));
    } catch (error) {
        if (error.code === 400 || error.code === 404) {
            // Sheet is empty or doesn't exist yet
            return new Set();
        }
        throw error;
    }
}

// Fetch trending YouTube videos based on a keyword with pagination
//This ensures: Only 1 page is fetched. Only 10 results are requested from the YouTube API.
async function fetchTrendingVideos(keyword, maxPages = 1, maxResultsPerPage = 10) {
    const allVideos = [];
    let nextPageToken = null;
    let page = 0;

    do {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q: keyword,
                type: 'video',
                order: 'viewCount',
                maxResults: maxResultsPerPage,
                pageToken: nextPageToken,
                key: YOUTUBE_API_KEY,
            },
        });

        const items = response.data.items.map((item) => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            channelTitle: item.snippet.channelTitle,
            publishTime: item.snippet.publishTime,
        }));

        allVideos.push(...items);
        nextPageToken = response.data.nextPageToken;
        page += 1;
    } while (nextPageToken && page < maxPages);

    return allVideos;
}

// Analyze video content using OpenAI to extract content angles and generate new ideas
async function analyzeContent(title, description) {
    const messages = [
        {
            role: "system",
            content: "You are a marketing assistant. Analyze YouTube video content and suggest new ideas.",
        },
        {
            role: "user",
            content: `Given the video title: "${title}" and description: "${description}", identify the main content angle and suggest two new video ideas that would appeal to the same audience.`,
        },
    ];

    const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages,
        max_tokens: 200,
    });

    return response.choices[0].message.content.trim();
}

// Append data to Google Sheet
async function appendToGoogleSheet(sheets, rows) {
    await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${GOOGLE_SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        resource: {
            values: rows,
        },
    });
}

// Main function to orchestrate the workflow
async function main() {
    console.log("🚀 Script started");
    try {
        const keyword = 'AI calorie tracker';
        const sheets = await authenticateGoogleSheets();
        const existingVideoIds = await fetchExistingVideoIds(sheets);
        const videos = await fetchTrendingVideos(keyword);
        const rows = [];

        for (const video of videos) {
            if (existingVideoIds.has(video.videoId)) {
                console.log(`⚠️ Skipping duplicate: ${video.videoId}`);
                continue;
            }

            console.log(`Analyzing: ${video.title}`);
            const analysis = await analyzeContent(video.title, video.description);
            rows.push([
                video.videoId,
                video.title,
                video.description,
                video.channelTitle,
                video.publishTime,
                analysis,
            ]);
        }

        if (rows.length > 0) {
            await appendToGoogleSheet(sheets, rows);
            console.log('✅ New data appended to Google Sheet.');
        } else {
            console.log('ℹ️ No new videos to append.');
        }
    } catch (error) {
        console.error('❌ An error occurred:', error);
    }
}

main();
