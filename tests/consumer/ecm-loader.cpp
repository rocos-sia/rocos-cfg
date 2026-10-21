#include "EcConfig.h"
#include <yaml-cpp/yaml.h>
#include <iostream>
// File parsing only: deliberately link no EtherCAT SDK or master entry point.
int main(int argc,char** argv) {
    if(argc!=2)return 2;
    try {
        const auto c=LoadEcConfig(argv[1]);
        YAML::Node n;
        n["id"]=c.id;n["cpuidx"]=c.cpuidx;n["cycle"]=c.cycle;
        n["duration"]=c.duration;n["verbose"]=c.verbose;n["state"]=c.state;
        n["ctloff"]=c.ctloff;n["eni"]=c.eni;n["log"]=c.log;n["license"]=c.license;
        n["has_sp"]=c.has_sp;n["has_flash"]=c.has_flash;n["has_mbxsrv"]=c.has_mbxsrv;
        n["sp"]=c.sp;n["flash"]=c.flash;n["mbxsrv"]=c.mbxsrv;
        YAML::Emitter output;output.SetStringFormat(YAML::DoubleQuoted);output<<n;
        std::cout<<output.c_str()<<'\n';return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 3;}
}
