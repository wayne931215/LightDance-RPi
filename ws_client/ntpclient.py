import socket
import subprocess
from datetime import datetime
from config import *

HOST = (SERVER_IP, NTP_SERVER_PORT)


class NTPClient:
    def __init__(self, callBack = None) -> None:
        self.timeData = {"t0": None, "t1": None, "t2": None, "t3": None}
        self.callBack: function = callBack 

    def startTimeSync(self) -> None:
        with self.client as client:
            self.timeData = {
                "t0": datetime.now().timestamp() * 1000,
                "t1": None,
                "t2": None,
                "t3": None,
            }
            client.sendto("startSync".encode(), HOST)
            print("Start time sync:", self.timeData)
            self.recvMes()

    def recvMes(self) -> dict:
        mes, addr = self.client.recvfrom(1024)
        serverSysTime = int(mes.decode())
        print(f"Receive data: {serverSysTime} from {addr}")
        return self.setTime(serverSysTime)

    def setTime(self, serverSysTime: int) -> dict:
        self.timeData["t1"] = serverSysTime
        self.timeData["t2"] = serverSysTime
        self.timeData["t3"] = datetime.now().timestamp() * 1000

        t0 = self.timeData["t0"]
        t1 = self.timeData["t1"]
        t2 = self.timeData["t2"]
        t3 = self.timeData["t3"]
        print(f"t0: {t0}, t1: {t1}, t2: {t2}, t3: {t3}")

        offset = round(((t1 - t0) + (t2 - t3)) / 2)
        delay = round((t3 - t0) - (t2 - t1))
        # print(f"sudo date +%s -s @{(t2 + delay) / 1000}")
        command = f"sudo date +%s.%N -s @{((datetime.now().timestamp() * 1000) + offset + 20) / 1000}"
        subprocess.run(command, shell=True, check=True)

        print(f"delay: {delay}ms, offset: {offset}ms")
        return {"delay": delay, "offset": offset}
