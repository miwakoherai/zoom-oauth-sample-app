const axios = require("axios");
const fs = require("fs");
const moment = require("moment-timezone");
const schedule = require("node-schedule");
const logger = require("./logger");

const makeApiRequest = async (url) => {
  try {
    const response = await axios.get(url);
    const data = response.data;
    if (data.items && data.items.length > 0) {
      return data.items[0];
    }
  } catch (error) {
    logger.error(`An error occurred: ${error}`);
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
    key: process.env.API_KEY,
  });
  const item = await makeApiRequest(url);
  return item ? item.id.videoId : null;
};

const getLiveViewerCount = async (videoId) => {
  const url = buildUrl("https://www.googleapis.com/youtube/v3/videos", {
    part: "liveStreamingDetails",
    id: videoId,
    key: process.env.API_KEY,
  });
  const item = await makeApiRequest(url);
  return item ? item.liveStreamingDetails.concurrentViewers : null;
};
const writeToFile = (viewerCount) => {
  const now = moment().tz("Asia/Tokyo");
  const fileName = `${now.format("YYYY-MM-DD")}_YouTube.txt`;
  const log = `${now.format("HH:mm:ss")}: 視聴者数: ${viewerCount}\n`;
  fs.appendFileSync(fileName, log);
};

const recordViewers = async () => {
  try {
    const videoId = await getLiveVideoId(process.env.YOUTUBE_CHANNEL_ID);
    if (videoId) {
      const viewerCount = await getLiveViewerCount(videoId);
      console.log(`視聴者数: ${viewerCount}`);
      writeToFile(viewerCount);
    } else {
      console.log("現在、ライブ配信が行われていません。");
    }
  } catch (error) {
    winston.error(`An error occurred: ${error}`);
  }
};

const job = async (jobEnd) => {
  try {
    const now = moment().tz("Asia/Tokyo");
    if (now.isoWeekday() < 6) {
      const startTime = moment().hour(21).minute(0);
      const endTime = moment().hour(22).minute(33);
      if (now.isBetween(startTime, endTime)) {
        await recordViewers();
      } else if (now.isAfter(endTime)) {
        jobEnd[0] = true;
      }
    }
  } catch (error) {
    console.error(`An error occurred: ${error}`);
  }
};

const main = async () => {
  console.log("Program started."); // winston.infoをconsole.logに変更
  const jobEnd = [false];
  const jobSchedule = schedule.scheduleJob("*/1 * * * *", async () => {
    await job(jobEnd);
    if (jobEnd[0]) {
      jobSchedule.cancel();
      console.log("Main loop finished."); // winston.infoをconsole.logに変更
    }
  });
  console.log("Main loop started."); // winston.infoをconsole.logに変更
};

module.exports = main;
