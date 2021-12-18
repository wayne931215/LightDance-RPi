from shutDown import ShutDown
from reboot import Reboot
from uploadJsonFile import UploadJsonFile

methods = {
    "shutDown": ShutDown(),
    "reboot": Reboot(),
    "uploadControl": UploadJsonFile(),
}

if __name__ == "__main__":
    # methods["reboot"]()
    # methods["shutDown"]()
    # methods["uploadControl"]({
    #     "dir": "../data",
    #     "file": data
    # })
    pass