// Compile the original consumer parsing functions, never instantiate Hardware.
#include "hardware.hpp"
#include "joint_binding.hpp"
#include "logger.hpp"
#include "spdlog/sinks/null_sink.h"
#include <yaml-cpp/yaml.h>
#include <iostream>

// No files, threads, shared memory or hardware: only suppress parser logging.
Logger::logger_ptr Logger::getInstance(const std::string& name) {
    auto log = std::make_shared<spdlog::async_logger>(name,
        std::make_shared<spdlog::sinks::null_sink_mt>(),
        std::weak_ptr<spdlog::details::thread_pool>());
    log->set_level(spdlog::level::off);
    return log;
}
int main(int argc, char** argv) {
    if (argc < 2) return 2;
    try {
        const auto config = rocos::Hardware::LoadConfigFromYAML(argv[1]);
        YAML::Node out;
        out["drives"] = YAML::Node(YAML::NodeType::Sequence);
        std::vector<int32_t> ids;
        for (const auto& d : config.drives) {
            ids.push_back(d.id);
            YAML::Node n;
            n["id"] = d.id; n["joint_name"] = d.joint_name;
            n["ratio"] = d.transform.ratio; n["offset"] = d.transform.offset_pos_cnt;
            n["count"] = d.transform.cnt_per_unit; n["torque"] = d.transform.torque_per_unit;
            n["unit"] = d.transform.user_unit_name;
            n["lower"] = d.limit.lower; n["upper"] = d.limit.upper;
            n["vel"] = d.limit.vel; n["acc"] = d.limit.acc; n["jerk"] = d.limit.jerk; n["effort"] = d.limit.effort;
            n["torque_source"] = d.torque_source == rocos::TorqueSource::SecondaryPosition ? "secondary_position" : "load_torque";
            n["status_word"] = d.inputs.status_word;
            n["secondary_position_value"] = d.inputs.secondary_position_value;
            n["target_position"] = d.outputs.target_position;
            out["drives"].push_back(n);
        }
        out["ft"] = YAML::Node(YAML::NodeType::Sequence);
        for (const auto& f : config.ft_sensors) {
            YAML::Node n; n["id"] = f.id; n["fx"] = f.inputs.fx; n["offset_fx"] = f.offset.force.x(); n["offset_tz"] = f.offset.torque.z(); out["ft"].push_back(n);
        }
        out["io"] = YAML::Node(YAML::NodeType::Sequence);
        for (const auto& io : config.ios) {
            YAML::Node n; n["id"] = io.id; n["di"] = io.digital_in_channels; n["ao"] = io.analog_out_channels;
            n["do_feedback"] = io.inputs.digital_outputs; n["do_output"] = io.outputs.digital_outputs;
            out["io"].push_back(n);
        }
        if (argc >= 3) {
            std::vector<std::string> names; for (int i = 3; i < argc; ++i) names.push_back(argv[i]);
            rocos::JointBinding binding;
            if (binding.Configure(names, ids) != rocos::Result::NoError || binding.LoadFromYaml(argv[2]) != rocos::Result::NoError) return 3;
            for (const auto id : binding.GetModelIndexToDriveIds()) out["bindings"].push_back(id);
        }
        std::cout << out << '\n';
        return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
