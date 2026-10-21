#include "model.hpp"
#include <json.hpp>
#include <iostream>
#include <fstream>
// Model constructs local kinematics solvers only. No Robot, Hardware or SDK.
int main(int argc,char** argv){
    if(argc!=5)return 2;
    try{
        rocos::Model model(argv[1],argv[2],argv[3]);
        nlohmann::json joints=nlohmann::json::array();
        const auto names=model.GetJointNames();
        for(unsigned int i=0;i<names.size();++i)joints.push_back({{"name",names[i]},
            {"lower",model.GetPosLowerLimit()(i)},{"upper",model.GetPosUpperLimit()(i)},
            {"velocity",model.GetVelocityLimit()(i)},{"effort",model.GetEffortLimit()(i)}});
        std::ofstream output(argv[4]);output<<joints.dump()<<'\n';
        return output.good()?0:4;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 3;}
}
