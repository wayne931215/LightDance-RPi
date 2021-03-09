const WebSocket = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const shell = require("shelljs");
const readline = require("readline");

class RpiSocket {
    constructor() {
        this.wsClient = null;
        this.controller = null; //c++ child process
        this.cmdFromServer = null;
        this.cppTask = null;
        this.connected = false;
        this.needToReconnect = true;
        this.musicPlaying = false;
        this.init();
    }
    init = () => {
        this.connectWebsocket();
    };
    connectWebsocket = () => {
        this.wsClient = new WebSocket("ws://localhost:8080");
        if (this.wsClient.readyState !== WebSocket.CONNECTING) {
            setTimeout(() => {
                this.init();
            }, 3000);
            return;
        } else {
            this.listeningServer();
        }
    };
    listeningServer = () => {
        this.wsClient.onopen = () => {
            this.connectedBefore = true;
            console.log("Websocket connected.");
            this.sendDataToServer([
                "boardInfo",
                {
                    //send boardInfo while connected to server
                    name: os.hostname(),
                    OK: true,
                    type: "dancer",
                    msg: "Success",
                },
            ]);
        };
        this.wsClient.onerror = (err) => {
            console.log(`Websocket error: ${err.message}`);
        };
        this.wsClient.onmessage = (mes) => {
            const data = mes.data;
            console.log(`Data from server: ${data}`);
            this.parseServerData(data);
        };
        this.wsClient.onclose = (e) => {
            console.log("Websocket client closed.");
            if (!this.musicPlaying && this.controller !== null)
                this.controller.kill(); //若音樂在播而不小心斷線，就不管

            if (this.needToReconnect) {
                console.log("Websocket client reconnecting to server...");
                setTimeout(() => {
                    this.init();
                }, 3000);
                return;
            } else process.exit();
        };
    };
    listeningCpp = () => {
        const parseCppData = this.parseCppData;
        // Listening to stdout
        const rl = readline.createInterface({
            input: this.controller.stdout,
        });

        rl.on("line", function (line) {
            const data = line.trim();
            if (data.length) {
                console.log(`Data from C++: ${data}`);
                parseCppData(data);
            }
        });

        // Listening to error
        const rlErr = readline.createInterface({
            input: this.controller.stderr,
        });

        rlErr.on("line", function (line) {
            const data = line.trim();
            if (data.length) {
                console.log(`Data from C++: ${data}`);
                parseCppData(data);
            }
        });
    };
    parseServerData = (mes) => {
        const [task, payload] = this.parseData(mes);
        console.log("Command: ", task, "\nPayload: ", payload);
        this.cmdFromServer = task;
        // if (this.controller !== null) this.listeningCpp();
        try {
            switch (this.cmdFromServer) {
                case "start": {
                    //start c++ file
                    if (this.controller !== null) {
                        console.log("Killing running C++.");
                        this.controller.kill();
                        console.log("Running C++ is killed");
                    }
                    try {
                        // console.log("Starting controller...");
                        this.controller = spawn(`../../RPIController/RPIController ${payload}`); //use ./test to test, change to ./controller for real time deployment
                        this.controller.on("error", (err) => {
                            console.log(err);
                        })
                    } catch (err){
                        console.log(err);
                    }
                    this.listeningCpp();
                    break;
                }
                case "play": {
                    //start playing
                    const startTime = payload.startTime; //從整首歌的第幾秒播放
                    const whenToPlay = payload.whenToPlay; //Rpi從此確切時間開始播放
                    this.sendDataToCpp(`PLay ${startTime} ${whenToPlay}`);
                    break;
                } //back to server的部分還未確定
                case "pause": {
                    //pause playing
                    this.controller.kill("SIGINT");
                    break;
                }
                case "stop": {
                    //stop playing(prepare to start time)
                    this.sendDataToCpp("STOp"); //another SIG
                    break;
                }
                case "load": {
                    //call cpp to load play file.json
                    this.sendDataToCpp("Load");
                    break;
                }
                case "terminate": {
                    //terminate c++ file
                    if (this.controller !== null) this.controller.kill("SIGKILL");
                    this.sendDataToServer([
                        "terminate",
                        {
                            OK: true,
                            msg: "terminated",
                        },
                    ]);
                    break;
                }
                case "lightCurrentStatus": {
                    if (!fs.existsSync(path.join(__dirname, "../../data")))
                        fs.mkdirSync(path.join(__dirname, "../../data"));
                    fs.writeFile(
                        path.join(__dirname, "../../data/status.json"),
                        JSON.stringify(payload),
                        (err) => {
                            if (err) {
                                console.log("lightCurrentStatus file failed.");
                                this.sendDataToServer([
                                    "lightCurrentStatus",
                                    {
                                        OK: false,
                                        msg: "upload failed",
                                    },
                                ]);
                                throw err;
                            } else {
                                console.log("lightCurrentStatus file success.");
                                this.sendDataToServer([
                                    "lightCurrnetStatus",
                                    {
                                        OK: true,
                                        msg: "upload success",
                                    },
                                ]);
                            }
                        }
                    );
                    this.sendDataToCpp(["STAtuslight"]);
                    break;
                }
                //above are commands sending to clientApp(controller.cpp)
                case "kick": {
                    //reconnect to websocket server
                    this.wsClient.close();
                    this.wsClient.onclose = (e) => {
                        console.log(
                            "Websocket client is manually diconnect,reconnecting to websocket server..."
                        );
                    };
                    delete this.wsClient;
                    this.connectWebsocket();
    
                    if (this.controller !== null) this.controller.kill("SIGKILL");
                    this.controller = null;
                    this.cmdFromServer = null;
                    this.cppTask = null;
                    this.musicPlaying = false;
                    break;
                }
                case "uploadControl": {
                    //load timeline.json to local storage(./current)
                    //console.log(payload);
                    if (!fs.existsSync(path.join(__dirname, "../../data")))
                        fs.mkdirSync(path.join(__dirname, "../../data"));
                    fs.writeFile(
                        path.join(__dirname, "../../data/control.json"),
                        JSON.stringify(payload),
                        (err) => {
                            if (err) {
                                console.log("Upload control file failed.");
                                this.sendDataToServer([
                                    "uploadControl",
                                    {
                                        OK: false,
                                        msg: "upload failed",
                                    },
                                ]);
                                throw err;
                            } else {
                                console.log("Upload control file success.");
                                this.sendDataToServer([
                                    "uploadControl",
                                    {
                                        OK: true,
                                        msg: "upload success",
                                    },
                                ]);
                            }
                        }
                    );
                    break;
                }
                case "uploadLED": {
                    //load led picture files to ./control/LED
                    if (!fs.existsSync(path.join(__dirname, "../../asset")))
                        fs.mkdir(
                            fs.existsSync(path.join(__dirname, "../../asset"))
                        );
                    fs.writeFile(
                        path.join(__dirname, "../../asset/LED.json"),
                        JSON.stringify(payload),
                        (err) => {
                            if (err) {
                                console.log("Upload LED file failed.");
                                this.sendDataToServer([
                                    "uploadLED",
                                    {
                                        OK: false,
                                        msg: "upload failed",
                                    },
                                ]);
                                throw err;
                            } else {
                                console.log("Upload LED file success.");
                                this.sendDataToServer([
                                    "uploadLED",
                                    {
                                        OK: true,
                                        msg: "upload success",
                                    },
                                ]);
                            }
                        }
                    );
                    break;
                }
                case "shutDown": {
                    //shut down Rpi computer
                    this.needToReconnect = false;
                    shell.exec("shutdown -h 0");
                    break;
                }
                case "reboot": {
                    //reopen Rpi computer
                    shell.exec("reboot -h 0");
                    break;
                }
                case "sync": {
                    //payload 至少會有時間，將Rpi的時間與電腦同步\
    
                    break;
                }
                case "boardInfo": {
                    this.sendDataToServer([
                        "boardInfo",
                        {
                            //send boardInfo while connected to server
                            name: os.hostname(),
                            type: "dancer",
                            OK: true,
                            msg: "Success",
                        },
                    ]);
                    break;
                }
            }
        } catch (err) {
            if (this.controller === null || !this.controller.connected) {
                this.sendDataToServer([
                    task,
                    {
                        OK: 0,
                        msg: "controller isn't started yet or disconnect unexpected, please press \"start\" button again"
                    }
                ]);
            }
            // else if (){

            // }
            else if (err instanceof TypeError){

            }
            else if (err instanceof SyntaxError){

            }
            else if (err instanceof EvalError){

            }
            else {
                this.sendDataToServer([
                    task,
                    {
                        OK: 0,
                        msg: err
                    }
                ])
            }
        }
    };
    parseCppData = (mes) => {
        // const message = mes.toString().trim().split(" ");

        // this.cppTask = message[0];
        // const OK = message[0].toLowerCase() === "success";
        const message = mes.toString().trim();
        const OK = message.toLowerCase().includes("success");

        console.log("Controller response: ", message);
        this.sendDataToServer([
            this.cppTask,
            {
                OK,
                msg: message
            }
        ])
    };
    sendDataToServer = (data) => {
        this.wsClient.send(JSON.stringify(data));
    };
    sendDataToCpp = (data) => {
        try {
            console.log(`Data to C++: ${data}`);
            this.controller.stdin.write(`${data}\n`);
        } catch (err){
            this.sendDataToServer(["Error", {
                ...data
            }]);
        };
    };
    parseData = (data) => {
        console.log(`Data: ${data}`);
        return JSON.parse(data);
    };
    cppErrorHandle = (func) => {
        console.log("Handle error...");
        if (this.controller === null) {
            //C++ not launched or launch failed
            console.log("C++ is not running or has unexpected error");
            this.sendDataToServer(["Error", "Needs to start/restart C++"]);
        } else func;
    };
}

const mainSocket = () => {
    const rpiSocket = new RpiSocket();
};

mainSocket();
