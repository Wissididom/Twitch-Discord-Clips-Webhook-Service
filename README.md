# Twitch-Discord-Clips-Webhook-Service

## Prerequisites

- NodeJS
- Discord Webhook URL
- Twitch Client ID
- Twitch Client Secret

## How to setup

### Step 1

Clone this repository

`git clone https://github.com/Wissididom/Twitch-Discord-Clips-Webhook-Service`

### Step 2

Copy `example.env` into `.env` and adjust it's values. Optionally you can also provide the options inside `example.env` with the correct values as environment variables to the application.

### Step 3

Install dependencies

`npm i` or `npm install`

### Step 4

Run it with `node index.js`. The script checks every second if there were clips made in the last second.
