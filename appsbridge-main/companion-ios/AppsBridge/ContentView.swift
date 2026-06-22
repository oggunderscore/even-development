import SwiftUI

struct ContentView: View {
    @StateObject private var vm = AppViewModel()

    var body: some View {
        NavigationStack {
            List {
                // Bridge toggle
                Section {
                    HStack {
                        Circle()
                            .fill(vm.snapshot.running ? Color.green : Color.secondary.opacity(0.4))
                            .frame(width: 8, height: 8)
                        Text(vm.snapshot.running
                             ? "Running · localhost:\(BridgeServer.port)"
                             : "Stopped")
                            .foregroundStyle(vm.snapshot.running ? .primary : .secondary)
                    }

                    Button(vm.snapshot.running ? "Stop Bridge" : "Start Bridge") {
                        vm.toggle()
                    }
                    .foregroundStyle(vm.snapshot.running ? .red : .accentColor)
                }

                // GPS
                Section("GPS") {
                    let spd = vm.snapshot.speed
                    DataRow(label: "speed",
                            value: "\(fmt1(spd * 3.6)) km/h  ·  \(fmt1(spd * 2.237)) mph")
                    DataRow(label: "heading",
                            value: vm.snapshot.heading.map { "\(fmt0($0))°" } ?? "--")
                    DataRow(label: "lat",
                            value: vm.snapshot.lat.map { String(format: "%.5f", $0) } ?? "--")
                    DataRow(label: "lng",
                            value: vm.snapshot.lng.map { String(format: "%.5f", $0) } ?? "--")
                    DataRow(label: "accuracy",
                            value: vm.snapshot.accuracy.map { "\(fmt0($0)) m" } ?? "--")
                }

                // Media
                Section("Media") {
                    DataRow(label: "title",  value: vm.snapshot.title.isEmpty  ? "--" : vm.snapshot.title)
                    DataRow(label: "artist", value: vm.snapshot.artist.isEmpty ? "--" : vm.snapshot.artist)
                    DataRow(label: "status", value: vm.snapshot.status)
                }

                // Flipper Zero bridge
                Section("Flipper Zero") {
                    HStack {
                        Circle()
                            .fill(vm.flipperSnapshot.running ? Color.green : Color.secondary.opacity(0.4))
                            .frame(width: 8, height: 8)
                        Text(vm.flipperSnapshot.running
                             ? "Running · ws://127.0.0.1:\(FlipperWsServer.port)/ws"
                             : "Stopped")
                            .foregroundStyle(vm.flipperSnapshot.running ? .primary : .secondary)
                            .font(.system(.footnote, design: .monospaced))
                    }

                    Button(vm.flipperSnapshot.running ? "Stop Flipper Bridge" : "Start Flipper Bridge") {
                        vm.toggleFlipper()
                    }
                    .foregroundStyle(vm.flipperSnapshot.running ? .red : .accentColor)

                    let info = vm.flipperSnapshot.bleInfo
                    DataRow(label: "ble",
                            value: vm.flipperSnapshot.bleState
                                   + (info != nil ? " (\(info!))" : ""))
                    DataRow(label: "frames",
                            value: "\(vm.flipperSnapshot.frames)  skips \(vm.flipperSnapshot.skips)")
                }

                // D-pad (only shown while Flipper bridge is running)
                if vm.flipperSnapshot.running {
                    Section("D-pad") {
                        VStack(spacing: 8) {
                            HStack {
                                Spacer()
                                DpadButton(label: "↑") { vm.sendFlipperButton("up") }
                                Spacer()
                            }
                            HStack(spacing: 24) {
                                Spacer()
                                DpadButton(label: "←") { vm.sendFlipperButton("left") }
                                DpadButton(label: "OK") { vm.sendFlipperButton("ok") }
                                DpadButton(label: "→") { vm.sendFlipperButton("right") }
                                Spacer()
                            }
                            HStack {
                                Spacer()
                                DpadButton(label: "↓") { vm.sendFlipperButton("down") }
                                Spacer()
                            }
                            HStack {
                                Spacer()
                                DpadButton(label: "Back") { vm.sendFlipperButton("back") }
                                Spacer()
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("APPS Bridge")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Text("homeauto.cc")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func fmt1(_ v: Double) -> String { String(format: "%.1f", v) }
    private func fmt0(_ v: Double) -> String { String(format: "%.0f", v) }
}

struct DataRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 68, alignment: .leading)
            Text(value)
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
        }
    }
}

struct DpadButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(.body, design: .monospaced))
                .frame(width: 52, height: 36)
                .background(Color.secondary.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
