// File parsing only: no master, EtherCAT driver, shared memory or SDO calls.
#include "pdo_config.hpp"
#include <iostream>
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    rocos::PdoBusConfig config;
    std::string error;
    if (!rocos::loadPdoConfig(argv[1], config, error)) {
        std::cerr << error << '\n';
        return 1;
    }
    std::cout << "accepted\n";
    for (const auto &slave : config.slaves) {
        for (const auto &command : slave.init_commands) {
            for (unsigned int i = 0; i < command.size; ++i) {
                if (i) std::cout << ',';
                std::cout << static_cast<unsigned int>(command.data[i]);
            }
            std::cout << '\n';
        }
    }
}
