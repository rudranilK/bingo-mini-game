process.loadEnvFile();
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { insertData, getHashData } from "./utils/db.js";
import _ from "lodash";
import cron from "node-cron";

//! Temporary
const gameboards = [
  {
    0: 14,
    1: 6,
    2: 3,
    3: 19,
    4: 17,
    5: 30,
    6: 21,
    7: 25,
    8: 35,
    9: 40,
    10: 55,
    11: 43,
    12: null,
    13: 59,
    14: 54,
    15: 78,
    16: 82,
    17: 75,
    18: 64,
    19: 61,
    20: 89,
    21: 98,
    22: 91,
    23: 99,
    24: 83,
  },
  {
    0: 5,
    1: 19,
    2: 12,
    3: 4,
    4: 18,
    5: 22,
    6: 33,
    7: 25,
    8: 36,
    9: 38,
    10: 46,
    11: 51,
    12: null,
    13: 60,
    14: 53,
    15: 74,
    16: 76,
    17: 68,
    18: 64,
    19: 72,
    20: 81,
    21: 94,
    22: 98,
    23: 91,
    24: 87,
  },
];
const picked = [];
// const values = [14, 30, 55, 78, 89, 17, 35, 82, 89];
//! remove after testing

const colors = ["green", "blue"];
let currentBingoNo = null;
let cronTask;

if (!process.env.CRON_SCHEDULE || !process.env.PORT) {
  console.error(`CRON_SCHEDULE or PORT not defined`);
  process.exit(-1);
}

const app = express();
const server = createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.static(join(__dirname, `../public`)));

io.on("connection", async (socket) => {
  console.log(`a user connected with connection : ${socket.id}`);

  //* Generate a new clientId
  const clientId = uuidv4();
  const clients = (await getHashData("clients")) || {};

  clients[clientId] = JSON.stringify({
    connectionId: socket.id,
  });

  //* Insert new client details in redis
  await insertData("clients", clients);

  const connectionPayload = {
    clientId: clientId,
  };
  //* Return the clientId to UI on making a successful connection
  socket.emit("CONNECTION_ACK", JSON.stringify(connectionPayload));

  //* Event listner for Create game Event
  socket.on("CREATE_GAME", async (data, callback) => {
    const { clientId, username } = data;

    //Iterate through clients & validate
    const res = await updateUserName(clientId, username);
    if (res.err) {
      return callback(res);
    }

    const gameRes = await createGame(socket, clientId);
    if (gameRes.err) {
      return callback(gameRes);
    }

    //* Store gameboard for this user in Redis
    if (gameRes.gameId && gameRes.gameBoard) {
      await updateGameBoard(clientId, gameRes.gameId, gameRes.gameBoard);
    }

    console.log(`A user created game ${gameRes.gameId}`);

    callback({
      data: {
        clientDetails: res.clientDetails,
        gameData: gameRes,
      },
    });
  });

  //* Event listner for Join game Event
  socket.on("JOIN_GAME", async (data, callback) => {
    const { clientId, username, gamename: gameId } = data;

    //* Iterate through clients & validate
    const res = await updateUserName(clientId, username);
    if (res.err) {
      return callback(res);
    }

    const gameRes = await joinGame(socket, clientId, gameId);
    if (gameRes.err) {
      return callback(gameRes);
    }

    //* Store gameboard for this user in Redis
    if (gameRes.gameId && gameRes.gameBoard) {
      await updateGameBoard(clientId, gameRes.gameId, gameRes.gameBoard);
    }

    console.log(`A user joined game ${gameId}`);

    callback({
      data: {
        clientDetails: res.clientDetails,
        gameData: gameRes,
      },
    });

    //* Automated start game > Check to see if game can be started > broadcast bingoNo
    currentBingoNo = await updateGameStarted(gameId);

    //* If we have a bingoNo do the following
    if (currentBingoNo) {
      //* Broadcast the bingo No to all the clients of this room
      io.to(gameId).emit("BINGO_NUMBER", {
        bingoNumber: currentBingoNo,
      });

      //* Send consequtive bingo No's after an interval > Start the cron here
      cronTask = deployCron(io, gameId);
      cronTask.start();
    }
  });

  //* Event listner for When a num is selected by client - Event
  socket.on("NUMBER_SELECTED", async (data, callback) => {
    const { buttonText: number, clientId, gameId } = data;

    //* Validtion
    if (!clientId || !gameId) {
      return callback({
        err: `clientId or gameId not provided`,
      });
    }

    //! Start a redlock session id: gameId

    //* check if client is valid & part of the game & game is ONGOING
    const rawGameData = await getHashData("games", gameId);
    const gameDetails = rawGameData ? JSON.parse(rawGameData) : null;
    if (!gameDetails) {
      return callback({
        err: `Invlid gameId`,
      });
    }

    if (!gameDetails.state === "ONGOING") {
      return callback({
        err: "Game is not active!!",
      });
    }

    if (!gameDetails.clients.find((c) => c === clientId)) {
      return callback({
        err: "Client is not part of this game!",
      });
    }

    console.log(`Num selected by user : ${number}`);

    //* Check if no is the current bingo num
    if (parseInt(number) === currentBingoNo) {
      //* Check if num is part of board or not
      const res = await checkNumberExistsInBoard(
        gameId,
        clientId,
        currentBingoNo
      );

      //* If any error
      if (res?.err) {
        return callback(res);
      }

      //! End a redlock session id: gameId

      //* If there is a bingo positions will be returned with this ack only
      callback({
        data: res,
      });

      //* Check if there is a bingo acheived
      if (res?.bingoPositions) {
        //* Trigger another fun to check if there are 2 bingo's & emit event
        const winnerDetails = await checkGameWin(gameId, clientId);
        if (winnerDetails) {
          io.to(gameId).emit("GAME_END", winnerDetails);

          //* Stop the cron now
          console.info("Stopping cron job for this Game");
          if (cronTask) {
            cronTask.stop();
          }
        }
      }
    } else {
      //! End a redlock session id: gameId

      callback({
        err: `Number selected is not the bingo number`,
      });
    }
  });

  //* Event listner for disconnect event
  socket.on("disconnect", async () => {
    console.log(`user disconnected with id : ${socket.id}`);
  });
});

server.listen(process.env.PORT, async () => {
  // await insertColors(colors);
  console.log(`server running at http://localhost:${process.env.PORT}`);
});

async function createGame(socket, clientId) {
  try {
    const gameId = uuidv4();
    const games = (await getHashData("games")) || {};

    //* Create Game Details
    const gameObj = {
      clients: [clientId],
      state: "CREATED", // "CREATED", "ONGOING", "FINISHED"
      stats: {
        [clientId]: JSON.stringify({
          wins: 0,
          bingoPositions: [],
        }),
      },
      winner: null,
    };

    //* Insert Game Detils
    games[gameId] = JSON.stringify(gameObj);
    await insertData("games", games);

    //* Assign a color to user
    const userColor = colors[gameObj.clients.length - 1];

    //* Join the client to this game room
    socket.join(gameId);

    //* Design gameBoard and return to user
    return {
      gameId,
      userColor,
      // gameBoard: designGameBoard(),  //* Uncomment this
      gameBoard: gameboards[0], //! Remove this after testing
    };
  } catch (error) {
    return {
      err: error.message || `500: Some unexpected error`,
    };
  }
}

async function joinGame(socket, clientId, gameId) {
  try {
    const rawData = await getHashData("games", gameId);
    const gameDetails = rawData ? JSON.parse(rawData) : null;
    if (!gameDetails) {
      throw new Error("Invlid gameId");
    }

    //* Validtions
    if (gameDetails.state === "FINISHED") {
      throw new Error("Game has already finished");
    }

    if (gameDetails.clients?.length === 2) {
      throw new Error("Maximum participants for a game reached!");
    }

    if (gameDetails.clients.find((c) => c === clientId)) {
      throw new Error("Client is already part of the game!");
    }

    //* Update Game Details & insert in redis
    gameDetails.clients?.push(clientId);
    gameDetails.stats[clientId] = JSON.stringify({
      wins: 0,
      bingoPositions: [],
    });

    const games = (await getHashData("games")) || {};
    games[gameId] = JSON.stringify(gameDetails);

    await insertData("games", games);

    //* Assign a color to user
    const userColor = colors[gameDetails.clients.length - 1];

    //* Join the client to this game room
    socket.join(gameId);

    //* Design gameBoard and return to user
    return {
      gameId,
      userColor,
      // gameBoard: designGameBoard(), //* Uncomment this
      gameBoard: gameboards[1], //! Remove this after testing
    };
  } catch (error) {
    return {
      err: error.message || `500: Some unexpected error`,
    };
  }
}

async function updateUserName(clientId, username) {
  const rawData = await getHashData("clients", clientId);
  const clientDetails = rawData ? JSON.parse(rawData) : null;
  if (!clientDetails) {
    return {
      err: "Invlid clientId",
    };
  }

  //* Update & insert the username for the clientId
  const clients = (await getHashData("clients")) || {};

  clientDetails.username = username;
  clients[clientId] = JSON.stringify(clientDetails);

  await insertData("clients", clients);
  return { clientDetails };
}

async function updateGameStarted(gameId) {
  const rawData = await getHashData("games", gameId);
  const gameDetails = JSON.parse(rawData);

  if (gameDetails.clients.length === 2 && gameDetails.state === "CREATED") {
    //* Send a random Bingo number to client
    // const bingoNo = getRandomInt(1, 100);  //* Uncomment this
    const bingoNo = testSpecific(); //! Remove this after testing

    //* Update the game state to started
    const games = (await getHashData("games")) || {};
    gameDetails.state = "ONGOING";
    games[gameId] = JSON.stringify(gameDetails);

    await insertData("games", games);

    return bingoNo;
  }

  //* If not a perfect condition - return nothing
  return null;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function designGameBoard() {
  let begin = 0;
  let range = 20;
  let end = begin + range;
  let startIndex = 0;
  const gameBoard = {};

  for (let i = 0; i < 5; i++) {
    let numbers = 5;

    while (numbers > 0) {
      const randomNo = getRandomInt(begin, end);
      if (startIndex === 12) {
        gameBoard[startIndex++] = null;
      } else {
        gameBoard[startIndex++] = randomNo;
      }
      numbers--;
    }

    begin = end;
    end += range;
  }

  return gameBoard;
}

async function updateGameBoard(clientId, gameId, gameBoard) {
  try {
    //* Create  deep copy of the gameBoard
    const mappedGameBoard = structuredClone(gameBoard);

    //* Add isMarked field for every num on the board
    for (let key in mappedGameBoard) {
      const value = mappedGameBoard[key];

      mappedGameBoard[key] = JSON.stringify({
        value,
        //* Mark the center tile as marked true always
        isMarked: parseInt(key) === 12 ? true : false,
      });
    }

    await insertData(`${gameId}-${clientId}-board`, mappedGameBoard);
  } catch (error) {
    console.error(`Èrror occured: ${error.message}`);
  }
}

async function checkNumberExistsInBoard(gameId, clientId, bingoNo) {
  try {
    //* Fetch game Details from redis
    const gameBoardDetails = await getHashData(`${gameId}-${clientId}-board`);
    if (!gameBoardDetails) {
      throw new Error(`Invalid game details`);
    }

    for (let key in gameBoardDetails) {
      const details = JSON.parse(gameBoardDetails[key]);

      //* Check if bingoNo is present in the gameBoard

      if (details?.value === bingoNo) {
        //* Update the board details as that position is marked

        details.isMarked = true;
        gameBoardDetails[key] = JSON.stringify(details);
        await insertData(`${gameId}-${clientId}-board`, gameBoardDetails);

        //* Check if bingo is acheived
        return await checkIfBingo(key, gameId, clientId);
      }
    }

    //* If not a bingo num - fn returns undefined
  } catch (error) {
    return {
      err: error.message || `500: Some unexpected error`,
    };
  }
}

function sendBingo(io, gameId) {
  //* Generate a new Bingo num
  // currentBingoNo = getRandomInt(1, 100); //* Uncomment this

  currentBingoNo = testSpecific(); //! Remove after testing

  console.log("sending new bingoNo..", currentBingoNo);

  //* broadcast the bingo num to all clients in the game room
  io.to(gameId).emit("BINGO_NUMBER", {
    bingoNumber: currentBingoNo,
  });
}

async function checkIfBingo(position, gameId, clientId) {
  try {
    //! Create Lock with id : gameId
    const positionsToCheck = [
      [0, 6, 12, 18, 24], //* top-left to bottom-right diagonal
      [4, 8, 12, 16, 20], //* bottom-right to top-left diagonal
    ];

    //*Find the indices for the row
    positionsToCheck.push(findRowIndices(position));

    //*Find the indices for the column
    positionsToCheck.push(findColumnIndices(position));

    //*Check if there are other bingo's for this client
    const rawData = await getHashData("games", gameId);
    const gameDetails = rawData ? JSON.parse(rawData) : null;
    const existingBingos = JSON.parse(
      gameDetails.stats[clientId]
    )?.bingoPositions;

    //* Check if bingo is hit for any of these individual position arrays

    const gameBoard = await getHashData(`${gameId}-${clientId}-board`);
    if (!gameBoard) {
      throw new Error(`Invalid clientId or gameId`);
    }

    for (let group of positionsToCheck) {
      //* Check if this group is same as existingBingos

      if (existingBingos.length) {
        const sortedGroup = _.sortBy(group);

        const alreadyExists = existingBingos.find((positions) => {
          const sortedBingoPositions = _.sortBy(positions);
          return _.isEqual(sortedGroup, sortedBingoPositions);
        });

        if (alreadyExists) {
          continue; //* Skip this group
        }
      }

      const bingo = group.every((el) => {
        const details = JSON.parse(gameBoard[el]);
        if (details.isMarked) return true;

        return false;
      });

      //* Bingo acheived
      if (bingo) {
        //* Update game scores in Redis
        await updateGameStatus(gameId, clientId, group);

        return {
          message: "Bingo acheived",
          bingoPositions: group, //* 'bingoPositions' is only sent when Bingo is acheived
        };
      }
    }

    //* For all the rows, columns and diagonls bingo was not acheived
    return {
      message: "Bingo not acheived",
    };
  } catch (error) {
    return {
      err: error.message || `500: Some unexpected error`,
    };
  } finally {
    //! Relese redlock id: gameId
  }
}

function findRowIndices(position) {
  const row = position % 5;

  const indices = [];
  [0, 1, 2, 3, 4].forEach((el) => indices.push(el * 5 + row));

  return indices;
}

function findColumnIndices(position) {
  const column = Math.floor(position / 5); //13 -> 10,11,12,13,14

  const indices = [];
  [0, 1, 2, 3, 4].forEach((el) => {
    indices.push(5 * column + el);
  });

  return indices;
}

async function updateGameStatus(gameId, clientId, bingoPositions) {
  //* Find out the particular game details
  const rawData = await getHashData("games", gameId);
  const gameDetails = rawData ? JSON.parse(rawData) : null;

  //*Validtions
  if (!gameDetails) {
    throw new Error("Invlid gameId");
  }

  if (!gameDetails.clients.includes(clientId)) {
    throw new Error("Invlid clientId");
  }

  //* Update the stats
  const gameStats = JSON.parse(gameDetails.stats[clientId]);
  gameStats.wins += 1;
  gameStats.bingoPositions.push(bingoPositions);
  gameDetails.stats[clientId] = JSON.stringify(gameStats);

  //* Update games Map
  const games = (await getHashData("games")) || {};
  games[gameId] = JSON.stringify(gameDetails);

  await insertData("games", games);
}

async function checkGameWin(gameId, clientId) {
  //* Find out the particular game details
  const rawData = await getHashData("games", gameId);
  const gameDetails = rawData ? JSON.parse(rawData) : null;

  const gameStats = JSON.parse(gameDetails.stats[clientId]);

  if (gameStats.wins === 2) {
    gameDetails.state = "FINISHED";
    gameDetails.winner = clientId;

    //* Update games Map
    const games = (await getHashData("games")) || {};
    games[gameId] = JSON.stringify(gameDetails);
    await insertData("games", games);

    //* Fetch client Details
    const rawClientData = await getHashData("clients", clientId);
    const clientDetails = rawClientData ? JSON.parse(rawClientData) : null;

    //* Return winner's username
    return {
      winner: clientDetails.username,
    };
  }
}

function deployCron(io, gameId) {
  console.log("Cron task added");
  return cron.schedule(process.env.CRON_SCHEDULE, () => {
    sendBingo(io, gameId);
  });
}

//* additionl function for testing - REMOVE later
function testSpecific() {
  const values = [
    // ...Object.values(gameboards[0]),
    // ...Object.values(gameboards[1]),
    // 14, 6, 3, 19, 17,    //// 1st Column
    14,
    30,
    55,
    78,
    89, //// 1st Row
    // 14, 21, 64, 83,      //// 1st Diagonal
    17,
    35,
    82,
    89,
  ];

  if (picked.length === values.length) {
    picked.splice(0, picked.length);
  }

  let position = getRandomInt(0, values.length - 1);
  while (true) {
    if (!picked.includes(position)) {
      picked.push(position);
      break;
    }

    position = getRandomInt(0, values.length - 1);
  }

  return values[position];
  // return values.shift();
}
