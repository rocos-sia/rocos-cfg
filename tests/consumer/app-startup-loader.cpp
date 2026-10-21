#include "app_config.hpp"
#include <iostream>
// Construct only AppConfig's data. No Robot, Hardware, server or bus startup.
int main(int argc,char** argv){
    if(argc!=2)return 2;
    try{
        const auto c=rocos::AppConfig::load(argv[1]);
        nlohmann::json out={{"http_host",c.http_host},{"http_port",c.http_port},
            {"http_control_ttl_seconds",c.http_control_ttl_seconds},{"scripts",c.scripts},{"web_root",c.web_root},
            {"robot",{{"ecat_id",c.robot.ecat_id},{"hardware_config",c.robot.hardware_config},
                {"urdf",c.robot.urdf},{"base_link",c.robot.base_link},{"tip_link",c.robot.tip_link},
                {"joint_binding",c.robot.joint_binding},{"payload",c.robot.payload}}}};
        std::cout<<out.dump()<<'\n';return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 3;}
}
