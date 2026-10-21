// Compile separately against each consumer's original header. Never call init(),
// getInstance(), createSharedMemory() or any named IPC/driver operation.
#include "shared_memory_config.hpp"
#ifdef ROCOS_ABI_APP_HARDWARE
#include "hardware.hpp"
#endif
#include <climits>
#include <cstdio>
#include <memory>
#include <new>
#include <stdexcept>
#include <type_traits>

using rocos::EcatBus;
using rocos::PdVar;
using rocos::Slave;
static_assert(std::is_standard_layout<EcatBus>::value && std::is_trivially_copyable<EcatBus>::value, "EcatBus must have a copyable standard layout");
static_assert(std::is_standard_layout<Slave>::value && std::is_trivially_copyable<Slave>::value, "Slave must have a copyable standard layout");
static_assert(std::is_standard_layout<PdVar>::value && std::is_trivially_copyable<PdVar>::value, "PdVar must have a copyable standard layout");

static void require(bool ok, const std::string& reason) {
    if (!ok) throw std::runtime_error(reason);
}
#define NUMBER(name, value) std::cout << "\"" name "\":" << (value)
#define FIELD(type, member) std::cout << "\"" #member "\":{\"offset\":" << offsetof(type, member) << ",\"size\":" << sizeof(((type*)nullptr)->member) << "}"
#define STRUCT_START(type) std::cout << "\"" #type "\":{\"size\":" << sizeof(type) << ",\"alignment\":" << alignof(type) << ",\"fields\":{"
static void layout() {
    uint16_t endian = 1;
    std::cout << "{\"constants\":{";
    NUMBER("MAX_SLAVE_NUM", MAX_SLAVE_NUM); std::cout << ',';
    NUMBER("MAX_PDINPUT_NUM", MAX_PDINPUT_NUM); std::cout << ',';
    NUMBER("MAX_PDOUTPUT_NUM", MAX_PDOUTPUT_NUM); std::cout << ',';
    NUMBER("MAX_PD_NAME_LEN", MAX_PD_NAME_LEN); std::cout << ',';
    NUMBER("MAX_SLAVE_NAME_LEN", MAX_SLAVE_NAME_LEN); std::cout << ',';
    NUMBER("EC_SHM_MAX_SIZE", EC_SHM_MAX_SIZE); std::cout << ',';
    NUMBER("EC_SEM_NUM", EC_SEM_NUM);
    std::cout << "},\"primitives\":{";
    NUMBER("charBits", CHAR_BIT); std::cout << ',';
    NUMBER("int", sizeof(int)); std::cout << ',';
    NUMBER("long", sizeof(long)); std::cout << ',';
    NUMBER("pointer", sizeof(void*)); std::cout << ',';
    NUMBER("double", sizeof(double)); std::cout << ',';
    NUMBER("bool", sizeof(bool)); std::cout << ',';
    NUMBER("littleEndian", static_cast<int>(*reinterpret_cast<unsigned char*>(&endian)));
    std::cout << "},\"states\":{";
    NUMBER("init", ECAT_STATE_INIT); std::cout << ',';
    NUMBER("preop", ECAT_STATE_PREOP); std::cout << ',';
    NUMBER("safeop", ECAT_STATE_SAFEOP); std::cout << ',';
    NUMBER("op", ECAT_STATE_OP); std::cout << ',';
    NUMBER("bootstrap", ECAT_STATE_BOOTSTRAP);
    std::cout << "},\"structures\":{";
    STRUCT_START(PdVar);
    FIELD(PdVar, name); std::cout << ','; FIELD(PdVar, offset); std::cout << ',';
    FIELD(PdVar, size); std::cout << ','; FIELD(PdVar, index); std::cout << ','; FIELD(PdVar, sub_index);
    std::cout << "}},";
    STRUCT_START(Slave);
    FIELD(Slave, id); std::cout << ','; FIELD(Slave, name); std::cout << ',';
    FIELD(Slave, input_var_num); std::cout << ','; FIELD(Slave, output_var_num); std::cout << ',';
    FIELD(Slave, input_vars); std::cout << ','; FIELD(Slave, output_vars);
    std::cout << "}},";
    STRUCT_START(EcatBus);
    FIELD(EcatBus, timestamp); std::cout << ','; FIELD(EcatBus, min_cycle_time); std::cout << ',';
    FIELD(EcatBus, max_cycle_time); std::cout << ','; FIELD(EcatBus, avg_cycle_time); std::cout << ',';
    FIELD(EcatBus, current_cycle_time); std::cout << ','; FIELD(EcatBus, dt); std::cout << ',';
    FIELD(EcatBus, resetCycleTime); std::cout << ','; FIELD(EcatBus, current_state); std::cout << ',';
    FIELD(EcatBus, request_state); std::cout << ','; FIELD(EcatBus, next_expected_state); std::cout << ',';
    FIELD(EcatBus, is_authorized); std::cout << ','; FIELD(EcatBus, slave_num); std::cout << ','; FIELD(EcatBus, slaves);
    std::cout << "}}}}\n";
}

// Real MAP_SHARED storage in a caller-created temporary directory. The producer
// keeps its mapping alive while a separately compiled process reads and writes.
struct Sample {
    EcatBus bus;
    alignas(8) unsigned char input[MAX_SLAVE_NUM * MAX_PDINPUT_NUM * 8]{};
    alignas(8) unsigned char output[MAX_SLAVE_NUM * MAX_PDOUTPUT_NUM * 8]{};
};
struct Mapping {
    int fd{-1}; Sample* sample{nullptr};
    Mapping(const char* path, bool create) {
        fd = open(path, O_RDWR | O_NOFOLLOW | (create ? O_CREAT | O_EXCL : 0), 0600);
        require(fd >= 0, "Cannot open private ABI fixture");
        if (create && ftruncate(fd, sizeof(Sample)) != 0) { close(fd); throw std::runtime_error("Cannot size ABI fixture"); }
        struct stat st{};
        if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size != static_cast<off_t>(sizeof(Sample))) {
            close(fd); throw std::runtime_error("ABI fixture size does not match this build");
        }
        void* address = mmap(nullptr, sizeof(Sample), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (address == MAP_FAILED) { close(fd); throw std::runtime_error("Cannot map ABI fixture"); }
        sample = static_cast<Sample*>(address);
        if (create) new (sample) Sample{};
    }
    ~Mapping() { if (sample) munmap(sample, sizeof(Sample)); if (fd >= 0) close(fd); }
};
struct View {
    rocos::SharedMemoryConfig config;
    explicit View(Sample& sample) { config.ecatBus = &sample.bus; config.pdInputPtr = sample.input; config.pdOutputPtr = sample.output; }
    // These pointers are borrowed; prevent the original owner destructor from
    // attempting to unmap them with its normal five-megabyte region lengths.
    ~View() { config.ecatBus = nullptr; config.pdInputPtr = nullptr; config.pdOutputPtr = nullptr; }
};
static std::string variableName(bool output, int slave, int index, int count) {
    if (index == count - 1) return std::string(MAX_PD_NAME_LEN - 1, output ? 'O' : 'I');
    return std::string(output ? "OUT_信号_" : "IN_信号_") + std::to_string(slave) + "_" + std::to_string(index);
}
static uint64_t valueFor(bool output, int slave, int index) {
    return UINT64_C(0xfedcba9876543200) + (output ? 128 : 0) + slave * 31 + index;
}
static uint64_t narrowed(uint64_t value, int size) { return size == 8 ? value : value & ((UINT64_C(1) << (size * 8)) - 1); }
static void writeValue(unsigned char* address, int size, uint64_t value) {
    switch (size) {
        case 1: { auto v = static_cast<uint8_t>(value); std::memcpy(address, &v, 1); break; }
        case 2: { auto v = static_cast<uint16_t>(value); std::memcpy(address, &v, 2); break; }
        case 4: { auto v = static_cast<uint32_t>(value); std::memcpy(address, &v, 4); break; }
        case 8: std::memcpy(address, &value, 8); break;
        default: throw std::runtime_error("Invalid probe value width");
    }
}
static void variables(PdVar* vars, unsigned char* data, int count, int slave, bool output, bool initialize) {
    for (int j = 0; j < count; ++j) {
        auto& v = vars[j]; const auto name = variableName(output, slave, j, count);
        const int size = 1 << (j % 4), offset = (slave * count + j) * 8;
        const auto index = static_cast<uint16_t>((output ? 0x7000 : 0x6000) + slave);
        if (initialize) {
            std::strcpy(v.name, name.c_str()); v.offset = offset; v.size = size; v.index = index; v.sub_index = static_cast<uint8_t>(j);
            writeValue(data + offset, size, valueFor(output, slave, j));
        } else {
            require(std::string(v.name) == name && v.offset == offset && v.size == size && v.index == index && v.sub_index == j, "PDO descriptor mismatch");
        }
    }
}
static void initialize(Sample& s) {
    s.bus.timestamp = static_cast<long>(INT64_C(0x123456789abcd));
    s.bus.min_cycle_time = 999.125; s.bus.max_cycle_time = 1001.75; s.bus.avg_cycle_time = 1000.25; s.bus.current_cycle_time = 1000.5;
    s.bus.dt = 2000; s.bus.resetCycleTime = false; s.bus.current_state = ECAT_STATE_OP;
    s.bus.request_state = ECAT_STATE_OP; s.bus.next_expected_state = ECAT_STATE_SAFEOP; s.bus.is_authorized = true;
    s.bus.slave_num = MAX_SLAVE_NUM;
    for (int i = 0; i < MAX_SLAVE_NUM; ++i) {
        auto& slave = s.bus.slaves[i]; slave.id = i;
        const std::string name = i == MAX_SLAVE_NUM - 1 ? std::string(MAX_SLAVE_NAME_LEN - 1, 'S') : "Slave_" + std::to_string(i);
        std::strcpy(slave.name, name.c_str()); slave.input_var_num = MAX_PDINPUT_NUM; slave.output_var_num = MAX_PDOUTPUT_NUM;
        variables(slave.input_vars, s.input, MAX_PDINPUT_NUM, i, false, true);
        variables(slave.output_vars, s.output, MAX_PDOUTPUT_NUM, i, true, true);
    }
}
static void checkOriginal(Sample& s) {
#ifdef ROCOS_ABI_APP_HARDWARE
    require(rocos::Hardware::scanForEcatBus(&s, sizeof(s)) == &s.bus, "Original APP bus locator did not identify the producer's bus");
#endif
    View view(s); auto& c = view.config;
    require(c.getTimestamp() == static_cast<long>(INT64_C(0x123456789abcd)) && c.getDt() == 2000, "Timestamp/cycle mismatch");
    require(c.getBusMinCycleTime() == 999.125 && c.getBusMaxCycleTime() == 1001.75 && c.getBusAvgCycleTime() == 1000.25 && c.getBusCurrentCycleTime() == 1000.5, "Cycle statistics mismatch");
    require(c.getBusCurrentState() == ECAT_STATE_OP && c.isAuthorized() && c.getSlaveNum() == MAX_SLAVE_NUM && !s.bus.resetCycleTime && s.bus.request_state == ECAT_STATE_OP && s.bus.next_expected_state == ECAT_STATE_SAFEOP, "Bus control metadata mismatch");
    for (int i = 0; i < MAX_SLAVE_NUM; ++i) {
        auto& slave = s.bus.slaves[i];
        const std::string name = i == MAX_SLAVE_NUM - 1 ? std::string(MAX_SLAVE_NAME_LEN - 1, 'S') : "Slave_" + std::to_string(i);
        require(slave.id == i && c.getSlaveName(i) == name && slave.input_var_num == MAX_PDINPUT_NUM && slave.output_var_num == MAX_PDOUTPUT_NUM, "Slave descriptor mismatch");
        variables(slave.input_vars, s.input, MAX_PDINPUT_NUM, i, false, false);
        variables(slave.output_vars, s.output, MAX_PDOUTPUT_NUM, i, true, false);
        for (bool output : {false, true}) {
            const int count = output ? MAX_PDOUTPUT_NUM : MAX_PDINPUT_NUM;
            for (int j = 0; j < count; ++j) {
                const auto name = variableName(output, i, j, count); const int size = 1 << (j % 4); uint64_t value = 0;
#define READ_VALUE(type) (output ? c.getSlaveOutputVarValueByName<type>(i, name) : c.getSlaveInputVarValueByName<type>(i, name))
                switch (size) { case 1: value = READ_VALUE(uint8_t); break; case 2: value = READ_VALUE(uint16_t); break; case 4: value = READ_VALUE(uint32_t); break; case 8: value = READ_VALUE(uint64_t); break; }
                require(value == narrowed(valueFor(output, i, j), size), "Process-data value mismatch");
            }
        }
    }
    require(c.findSlaveInputVarPtrByName<int32_t>(0, "in_信号_0_2") == nullptr, "Variable names must remain case sensitive");
}
static void writeResponse(Sample& s) {
    View view(s); auto& c = view.config; const int slave = MAX_SLAVE_NUM - 1;
    c.setBusRequestState(ECAT_STATE_SAFEOP); c.resetCycleTime();
    auto* position = c.findSlaveOutputVarPtrByName<int32_t>(slave, variableName(true, slave, 2, MAX_PDOUTPUT_NUM));
    require(position != nullptr, "Output pointer not found"); *position = -123456789;
    c.setSlaveOutputVarValue<uint64_t>(slave, 3, UINT64_C(0xfedcba9876543210));
}
static void checkResponse(Sample& s) {
    View view(s); auto& c = view.config; const int slave = MAX_SLAVE_NUM - 1;
    require(s.bus.request_state == ECAT_STATE_SAFEOP && s.bus.resetCycleTime, "Control request was not visible to producer");
    require(c.getSlaveOutputVarValue<int32_t>(slave, 2) == -123456789, "Signed output response mismatch");
    require(c.getSlaveOutputVarValue<uint64_t>(slave, 3) == UINT64_C(0xfedcba9876543210), "64-bit output response mismatch");
    require(c.getSlaveInputVarValue<uint32_t>(slave, 2) == narrowed(valueFor(false, slave, 2), 4), "Input was changed by output write");
}
int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "layout") { layout(); return 0; }
#ifdef ROCOS_ABI_APP_HARDWARE
        if (argc == 2 && std::string(argv[1]).find("scan-") == 0) {
            std::unique_ptr<Sample> sample(new Sample{}); initialize(*sample);
            const std::string mode = argv[1];
            require(mode == "scan-valid" || mode == "scan-no-input" || mode == "scan-no-output", "Unknown scan fixture");
            if (mode == "scan-no-input") sample->bus.slaves[0].input_var_num = 0;
            if (mode == "scan-no-output") sample->bus.slaves[0].output_var_num = 0;
            std::cout << (rocos::Hardware::scanForEcatBus(sample.get(), sizeof(Sample)) == &sample->bus ? "LOCATED\n" : "REJECTED\n");
            return 0;
        }
#endif
        require(argc == 3, "Expected layout, serve <file>, or exchange <file>");
        const std::string mode = argv[1]; require(mode == "serve" || mode == "exchange", "Unknown probe mode");
        Mapping map(argv[2], mode == "serve");
        if (mode == "serve") {
            initialize(*map.sample); std::cout << "READY\n" << std::flush;
            std::string command; require(static_cast<bool>(std::getline(std::cin, command)), "Producer lost its test controller");
            if (command == "stop") return 0;
            require(command == "verify", "Unknown controller command"); checkResponse(*map.sample);
            std::cout << "VERIFIED\n";
        } else {
            checkOriginal(*map.sample); writeResponse(*map.sample); std::cout << "EXCHANGED\n";
        }
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
