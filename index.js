const dotenv = require('dotenv');
const request = require('request');
const express = require('express');
const { google } = require('googleapis');
const youtubeLiveViewerRecorder = require('./youtubeLiveViewerRecorder.js'); 
const logger = require('./logger');
dotenv.config();
const app = express();
const googleSheets = google.sheets({ version: 'v4' });

async function getGoogleAuthClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'countyoutubeaudience-e290fee05aa5.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return await auth.getClient();
}

async function updateSpreadsheet(values) {
  const client = await getGoogleAuthClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  await googleSheets.spreadsheets.values.update({
    auth: client,
    spreadsheetId,
    range: 'シート1!A2',
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });
}

function getMeetingInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const apiUrl = 'https://api.zoom.us/v2/past_meetings/83313322898/participants';
    const headers = { 'Authorization': 'Bearer ' + accessToken };

    request.get({ url: apiUrl, headers }, (error, response, body) => {
      if (error) {
        reject(error);
      } else {
        body = JSON.parse(body);
        let participationMap = new Map();

        for (let participant of body.participants) {
          let joinTime = new Date(participant.join_time);
          let leaveTime = new Date(participant.leave_time);

          joinTime.setSeconds(0);
          joinTime.setMilliseconds(0);

          leaveTime.setSeconds(0);
          leaveTime.setMilliseconds(0);
          leaveTime.setMinutes(leaveTime.getMinutes() + 1);

          let durationMinutes = Math.round((leaveTime - joinTime) / 60000);

          for (let i = 0; i < durationMinutes; i++) {
            let minute = new Date(joinTime.getTime() + i * 60000).toISOString();

            if (participationMap.has(minute)) {
              participationMap.set(minute, participationMap.get(minute) + 1);
            } else {
              participationMap.set(minute, 1);
            }
          }
        }

        let participationArray = Array.from(participationMap);
        participationArray.sort((a, b) => a[0].localeCompare(b[0]));

        let values = participationArray.map(([minute, count]) => [minute, count]);
        resolve({ body, values });
      }
    });
  });
}

app.get('/', async (req, res) => {
  if (req.query.code) {
    let url = 'https://zoom.us/oauth/token?grant_type=authorization_code&code=' + req.query.code + '&redirect_uri=' + process.env.redirectURL;

    request.post(url, async (error, response, body) => {
      body = JSON.parse(body);
      const access_token = body.access_token;

      if (access_token) {
        request.get('https://api.zoom.us/v2/users/me', async (error, response, body) => {
          body = JSON.parse(body);

          try {
            const { body: meetings, values } = await getMeetingInfo(access_token);
            await updateSpreadsheet(values);
            // Display response in browser
            // ...
          } catch (error) {
            // Handle error
          }
        }).auth(null, null, true, access_token);
      }
    }).auth(process.env.clientID, process.env.clientSecret);
  } else {
    res.redirect('https://zoom.us/oauth/authorize?response_type=code&client_id=' + process.env.clientID + '&redirect_uri=' + process.env.redirectURL);
  }
});

app.listen(33333, async () => {
  console.log("http://localhost:33333");
  await youtubeLiveViewerRecorder();
});
