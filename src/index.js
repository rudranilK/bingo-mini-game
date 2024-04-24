process.loadEnvFile();
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "socket.io";
import { getData, insertData, deleteData } from "./utils/db.js";

const app = express();
const server = createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.static(join(__dirname, `../public`)));

io.on("connection", async (socket) => {
  console.log("a user connected");
  await insertData("connectionId", socket.id);
  socket.on("disconnect", async () => {
    const con = await getData("connectionId");
    await deleteData("connection");
    console.log(`user disconnected with id : ${con}`);
  });
});

server.listen(process.env.PORT, () => {
  console.log(`server running at http://localhost:${process.env.PORT}`);
});
