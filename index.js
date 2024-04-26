const dotenv = require("dotenv");
const express = require("express");
const { google } = require("googleapis");
const axios = require("axios");
const fs = require("fs");
const moment = require("moment-timezone");
const schedule = require("node-schedule");
const logger = require("./logger.js");

dotenv.config();
const app = express();
const googleSheets = google.sheets({ version: "v4" });

async function getGoogleAuthClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "countyoutubeaudience-e290fee05aa5.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return await auth.getClient();
}

async function getMeetingInfo(accessToken) {
  console.log("accessToken:", accessToken);
  const pastMeetingsUrl =
    "https://api.zoom.us/v2/past_meetings/87669043537/participants";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  try {
    const response = await axios.get(pastMeetingsUrl, { headers });
    console.log("response:", response.data.participants);
    if (!response.status === 200) {
      throw new Error(`Error: ${response.status}`);
    }
    return processMeetingInfo(response.data);
  } catch (error) {
    console.error(`Failed to fetch past meeting participants: ${error}`);
    return null;
  }
}

function processMeetingInfo(body) {
  console.log("Processing meeting info:", body);

  let participationMap = new Map();

  for (let participant of body.participants) {
    console.log("Processing participant:", participant);

    let joinTime = moment(participant.join_time);
    let leaveTime = moment(participant.leave_time);

    console.log("Original join time:", joinTime.format("YYYY-MM-DD HH:mm"));
    console.log("Original leave time:", leaveTime.format("YYYY-MM-DD HH:mm"));

    joinTime.seconds(0);
    joinTime.milliseconds(0);

    leaveTime.seconds(0);
    leaveTime.milliseconds(0);
    leaveTime.add(1, "minutes");

    console.log("Adjusted join time:", joinTime.format("YYYY-MM-DD HH:mm"));
    console.log("Adjusted leave time:", leaveTime.format("YYYY-MM-DD HH:mm"));

    let durationMinutes = leaveTime.diff(joinTime, "minutes");
    console.log("Duration in minutes:", durationMinutes);

    for (let i = 0; i < durationMinutes; i++) {
      let minute = joinTime
        .clone()
        .add(i, "minutes")
        .format("YYYY-MM-DD HH:mm");

      console.log("Processing minute:", minute);

      if (participationMap.has(minute)) {
        participationMap.set(minute, participationMap.get(minute) + 1);
      } else {
        participationMap.set(minute, 1);
      }
    }
  }
  return participationMap;
}

const makeApiRequest = async (url) => {
  try {
    const { data } = await axios.get(url);
    if (data.items && data.items.length > 0) {
      return data.items[0];
    }
  } catch (error) {
    console.log(`An error occurred: ${error}`);
  }
  return null;
};

const buildUrl = (base, params) => {
  const url = new URL(base);
  Object.keys(params).forEach((key) =>
    url.searchParams.append(key, params[key])
  );
  return url.toString();
};

const getLiveVideoId = async (channelId) => {
  const url = buildUrl("https://www.googleapis.com/youtube/v3/search", {
    part: "id",
    channelId: channelId,
    eventType: "live",
    type: "video",
    key: process.env.YOUTUBE_API_KEY,
  });
  const item = await makeApiRequest(url);
  return item ? item.id.videoId : null;
};

const getLiveViewerCount = async (videoId) => {
  const url = buildUrl("https://www.googleapis.com/youtube/v3/videos", {
    part: "liveStreamingDetails",
    id: videoId,
    key: process.env.YOUTUBE_API_KEY,
  });
  const item = await makeApiRequest(url);
  return item ? item.liveStreamingDetails.concurrentViewers : null;
};

const writeToFile = (viewerCount) => {
  const now = moment().tz("Asia/Tokyo");
  const fileName = `${now.format("YYYY-MM-DD")}_YouTube.txt`;
  const log = `${now.format("YYYY-MM-DD HH:mm")} ${viewerCount}\n`;
  fs.appendFileSync(fileName, log);
};

const readFromFile = (fileName) => {
  if (!fs.existsSync(fileName)) {
    fs.writeFileSync(fileName, "");
    console.log(".textファイル作成");
  }
  const data = fs.readFileSync(fileName, "utf-8");
  const lines = data.split("\n").filter((line) => line.trim()); // 空行をフィルタリング
  const result = lines
    .map((line) => {
      const [date, time, countString] = line.split(" ");
      const datetime = `${date} ${time}`;
      const count = parseInt(countString, 10); // countを整数に変換
      if (isNaN(count)) {
        console.error(`Invalid count value: ${countString}`);
        return null;
      }
      return [datetime, count];
    })
    .filter((item) => item); // nullをフィルタリング

  return result;
};

// 最後に記録された時間を追跡する変数
let lastRecordedTime = null;

const recordViewers = async () => {
  const currentTime = moment().tz("Asia/Tokyo").format("YYYY-MM-DD HH:mm");
  // すでに同じ時間のデータを処理していたらエラーを投げる
  if (lastRecordedTime === currentTime) {
    throw new Error(`同じ時間(${currentTime})のデータはすでに処理済みです。`);
  }

  try {
    const videoId = await getLiveVideoId(process.env.YOUTUBE_CHANNEL_ID);
    if (videoId) {
      const viewerCount = await getLiveViewerCount(videoId);
      console.log(`視聴者数: ${viewerCount}`);
      writeToFile(viewerCount);
      // 最後に記録された時間を更新する
      lastRecordedTime = currentTime;
    } else {
      console.log("現在、ライブ配信が行われていません。");
    }
  } catch (error) {
    console.log(`An error occurred: ${error}`);
  }
};

const job = async (jobEnd) => {
  try {
    const now = moment().tz("Asia/Tokyo");
    const weekdayLimit = Number(process.env.WEEKDAY_LIMIT);

    if (now.isoWeekday() <= weekdayLimit) {
      const startTime = moment().hour(20).minute(50); //ライブ配信開始時間設定
      const endTime = moment().hour(22).minute(33); //ライブ配信終了時間設定

      if (now.isBetween(startTime, endTime)) {
        await recordViewers();
      } else {
        jobEnd[0] = true;
        console.log("recordViewers finished.");
      }
    } else {
      jobEnd[0] = true;
      console.log("recordViewers finished.on weekend");
    }
  } catch (error) {
    console.log(`An error occurred: ${error}`);
  }
};

function convertToDictionaryList(viewerCount) {
  // 最初の行をキーとして取得
  const keys = viewerCount[0];

  // オブジェクトのリストを作成
  const objectList = [];

  for (let i = 1; i < viewerCount.length; i++) {
    const obj = {};
    for (let j = 0; j < keys.length; j++) {
      obj[keys[j]] = viewerCount[i][j];
    }
    objectList.push(obj);
  }

  return objectList;
}

const scheduleJob = async () => {
  const jobEnd = [false];
  console.log("before schedule.schedulejobs.");
  console.log("http://localhost:33333");
  const jobSchedule = await schedule.scheduleJob("*/1 * * * *", async () => {
    console.log("before job.");
    await job(jobEnd);
    console.log("after job.");
    if (jobEnd[0]) {
      jobSchedule.cancel();
      console.log("Main loop finished.");
    }
  });
  console.log("after schedule.schedulejobs.");
  console.log("Main loop started.");
};

const handleOAuthFlow = async (req, res) => {
  if (req.query.code) {
    await computeTotalAndViewerMax(req, res);
    server.close();
    process.exit();
  } else {
    redirectToOAuthPage(res);
  }
};

const getZoomParticipantsCountList = async (req, res) => {
  const url =
    "https://zoom.us/oauth/token?grant_type=authorization_code&code=" +
    req.query.code +
    "&redirect_uri=" +
    process.env.OAUTH_REDIRECT_URL;
  console.log("url:", url);
  try {
    const { data: body } = await axios.post(url, null, {
      auth: {
        username: process.env.ZOOM_CLIENT_ID,
        password: process.env.ZOOM_CLIENTSECRET,
      },
    });
    const access_token = body.access_token;
    console.log("access_token:", access_token);
    if (access_token) {
      try {
        return await getMeetingInfo(access_token);
      } catch (error) {
        // Handle error
        console.log(`An error occurred : ${error}`);
        res.status(500).send("An error occurred while fetching user info.");
      }
    } else {
      res.status(500).send("An error occurred while fetching access token.");
    }
  } catch (error) {
    // Handle error
    console.log(`An error occurred: ${error}`);
    res.status(500).send("An error occurred while exchanging OAuth code.");
  }
};
async function computeTotalAndViewerMax(req, res) {
  console.log("Starting to compute total and viewer max...");
  const now = moment().tz("Asia/Tokyo");
  const fileName = `${now.format("YYYY-MM-DD")}_YouTube.txt`;
  const youtubeCounts = readFromFile(fileName);

  console.log(
    "Fetched YouTube viewer counts:",
    JSON.stringify(youtubeCounts, null, 2)
  );

  const zoomCounts = await getZoomParticipantsCountList(req, res);
  console.log(
    "Fetched Zoom participant counts:",
    JSON.stringify(zoomCounts, null, 2)
  );

  let combinedCounts = new Map();
  let maxCount = 0;

  // YouTubeのカウントを統合
  for (let [time, count] of youtubeCounts) {
    combinedCounts.set(time, (combinedCounts.get(time) || 0) + count);
  }
  console.log(
    "Combined counts after adding YouTube data:",
    Array.from(combinedCounts.entries())
  );

  // Zoomのカウントを統合
  for (let [time, count] of zoomCounts) {
    combinedCounts.set(time, (combinedCounts.get(time) || 0) + count);
  }
  console.log(
    "Combined counts after adding Zoom data:",
    Array.from(combinedCounts.entries())
  );

  // 結果をログに出力（または必要に応じて他の方法で保存）
  for (let [time, totalCount] of combinedCounts) {
    maxCount = Math.max(maxCount, combinedCounts.get(time));
    console.log(
      `Time: ${time}, Total Viewer Count: ${totalCount}, maxCount: ${maxCount}`
    );
  }

  console.log(`Maximum Viewer Count: ${maxCount}`);

  return maxCount;
}

const redirectToOAuthPage = (res) => {
  const url =
    "https://zoom.us/oauth/authorize?response_type=code&client_id=" +
    process.env.ZOOM_CLIENT_ID +
    "&redirect_uri=" +
    process.env.OAUTH_REDIRECT_URL;
  res.redirect(url);
};

app.get("/", handleOAuthFlow);
const server = app.listen(33333, async () => {
  console.log("Program started.");
  await scheduleJob();
});
