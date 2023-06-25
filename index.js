// Bring in environment secrets through dotenv
const dotenv = require('dotenv');
dotenv.config();

// Use the request module to make HTTP requests from Node
const request = require('request');

// Run the express app
const express = require('express');
const { google } = require('googleapis');


// Google SheetsのAPIをセットアップする
async function updateSpreadsheet(values) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'countyoutubeaudience-e290fee05aa5.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  // スプレッドシートにデータを書き込む
  const write = await googleSheets.spreadsheets.values.update({
    auth,
    spreadsheetId,
    range: 'シート1!A2',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values
    }
  }, {});
}

// 非同期関数を呼び出す
// updateSpreadsheet().catch(console.error);


const app = express()


// Function to get meeting information
function getMeetingInfo(accessToken, callback) {
  // Set the API endpoint URL
  const apiUrl = 'https://api.zoom.us/v2/past_meetings/83313322898/participants'

  // Set the request headers
  const headers = {
    'Authorization': 'Bearer ' + accessToken
  }

  // Send GET request to the API endpoint
  request.get({ url: apiUrl, headers: headers }, (error, response, body) => {
    if (error) {
      console.log('API Response Error: ', error)
      callback(error, null)
    } else {
      body = JSON.parse(body)

      // Create a map to hold the count of participants for each minute
      let participationMap = new Map()

      // Iterate over the participants
      for (let participant of body.participants) {
        // Parse join and leave times
        let joinTime = new Date(participant.join_time)
        let leaveTime = new Date(participant.leave_time)

        // Round down join time to the nearest minute
        joinTime.setSeconds(0)
        joinTime.setMilliseconds(0)

        // Round up leave time to the nearest minute
        leaveTime.setSeconds(0)
        leaveTime.setMilliseconds(0)
        leaveTime.setMinutes(leaveTime.getMinutes() + 1)

        // Calculate the number of minutes the participant was present
        let durationMinutes = Math.round((leaveTime - joinTime) / 60000)

        // Increment the count for each minute the participant was present
        for (let i = 0; i < durationMinutes; i++) {
          let minute = new Date(joinTime.getTime() + i * 60000).toISOString()

          if (participationMap.has(minute)) {
            participationMap.set(minute, participationMap.get(minute) + 1)
          } else {
            participationMap.set(minute, 1)
          }
        }
      }

      // Convert the map to a sorted array of [minute, count] pairs
      let participationArray = Array.from(participationMap)
      participationArray.sort((a, b) => a[0].localeCompare(b[0]))

      // Output the participant count for each minute
      console.log('Participant count by minute:')
      let values = [];
      for (let [minute, count] of participationArray) {
        values.push([minute, count]);
      }
      updateSpreadsheet(values)
      callback(null, body)
    }
  })
}


app.get('/', (req, res) => {

  // Step 1:
  // Check if the code parameter is in the URL
  // If an authorization code is available, the user has most likely been redirected from Zoom OAuth
  // If not, the user needs to be redirected to Zoom OAuth to authorize

  if (req.query.code) {

    // Step 3:
    // Request an access token using the auth code

    let url = 'https://zoom.us/oauth/token?grant_type=authorization_code&code=' + req.query.code + '&redirect_uri=' + process.env.redirectURL;

    request.post(url, (error, response, body) => {

      // Parse response to JSON
      body = JSON.parse(body);

      // Logs your access and refresh tokens in the browser
      console.log(`access_token: ${body.access_token}`);
      console.log(`refresh_token: ${body.refresh_token}`);
      const access_token = body.access_token;
      if (body.access_token) {

        // Step 4:
        // We can now use the access token to authenticate API calls

        // Send a request to get your user information using the /me context
        // The `/me` context restricts an API call to the user the token belongs to
        // This helps make calls to user-specific endpoints instead of storing the userID

        request.get('https://api.zoom.us/v2/users/me', (error, response, body) => {
          if (error) {
            console.log('API Response Error: ', error)
          } else {
            body = JSON.parse(body);
            // Display response in console
            console.log('API call ', body);

            // Get meeting information using the access token
            getMeetingInfo(access_token, (error, meetings) => {
              if (error) {
                // Handle error
              } else {
                // Display response in console
                console.log('Meeting Info: ', meetings);

                // Display response in browser
                var JSONResponse = '<pre><code>' + JSON.stringify(meetings, null, 2) + '</code></pre>'
                res.send(`
                  <style>
                    @import url('https://fonts.googleapis.com/css?family=Open+Sans:400,600&display=swap');
                    @import url('https://necolas.github.io/normalize.css/8.0.1/normalize.css');
                    html {
                      color: #232333;
                      font-family: 'Open Sans', Helvetica, Arial, sans-serif;
                      -webkit-font-smoothing: antialiased;
                      -moz-osx-font-smoothing: grayscale;
                    }
                    h2 {
                      font-weight: 700;
                      font-size: 24px;
                    }
                    h4 {
                      font-weight: 600;
                      font-size: 14px;
                    }
                    .container {
                      margin: 24px auto;
                      padding: 16px;
                      max-width: 720px;
                    }
                    .info {
                      display: flex;
                      align-items: center;
                    }
                    .info > div > span,
                    .info > div > p {
                      font-weight: 400;
                      font-size: 13px;
                      color: #747487;
                      line-height: 16px;
                    }
                    .info > div > span::before {
                      content: "👋";
                    }
                    .info > div > h2 {
                      padding: 8px 0 6px;
                      margin: 0;
                    }
                    .info > div > p {
                      padding: 0;
                      margin: 0;
                    }
                    .info > img {
                      background: #747487;
                      height: 96px;
                      width: 96px;
                      border-radius: 31.68px;
                      overflow: hidden;
                      margin: 0 20px 0 0;
                    }
                    .response {
                      margin: 32px 0;
                      display: flex;
                      flex-wrap: wrap;
                      align-items: center;
                      justify-content: space-between;
                    }
                    .response > a {
                      text-decoration: none;
                      color: #2D8CFF;
                      font-size: 14px;
                    }
                    .response > pre {
                      overflow-x: scroll;
                      background: #f6f7f9;
                      padding: 1.2em 1.4em;
                      border-radius: 10.56px;
                      width: 100%;
                      box-sizing: border-box;
                    }
                  </style>
                  <div class="container">
                    <div class="info">
                      <img src="${body.pic_url}" alt="User photo" />
                      <div>
                        <span>Hello World!</span>
                        <h2>${body.first_name} ${body.last_name}</h2>
                        <p>${body.role_name}, ${body.company}</p>
                      </div>
                    </div>
                    <div class="response">
                      <h4>JSON Response:</h4>
                      <a href="https://marketplace.zoom.us/docs/api-reference/zoom-api/users/user" target="_blank">
                        API Reference
                      </a>
                      ${JSONResponse}
                    </div>
                  </div>
                `);
              }
            });

          }
        }).auth(null, null, true, body.access_token);

      } else {
        // Handle errors, something's gone wrong!
      }

    }).auth(process.env.clientID, process.env.clientSecret);

    return;

  }

  // Step 2:
  // If no authorization code is available, redirect to Zoom OAuth to authorize
  res.redirect('https://zoom.us/oauth/authorize?response_type=code&client_id=' + process.env.clientID + '&redirect_uri=' + process.env.redirectURL)
})

app.listen(33333, () => console.log("http://localhost:33333"))
