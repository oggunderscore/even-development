import SwiftUI

struct ContentView: View {
    @StateObject private var vm = AppViewModel()
    @State private var shortcutsExpanded = false

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

                // Notifications
                Section("Notifications") {
                    // G2 connection status
                    HStack(spacing: 8) {
                        Circle()
                            .fill(vm.notifWsClientCount > 0 ? Color.green : Color.secondary.opacity(0.4))
                            .frame(width: 8, height: 8)
                        if vm.snapshot.running {
                            Text(vm.notifWsClientCount > 0
                                 ? "\(vm.notifWsClientCount) G2 glasses connected"
                                 : "Waiting for G2 glasses…")
                                .foregroundStyle(vm.notifWsClientCount > 0 ? .primary : .secondary)
                        } else {
                            Text("Bridge is stopped — tap Start above")
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Deepgram API key
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Deepgram API Key")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField(
                            vm.deepgramKeySaved ? "Saved — paste to update" : "Paste your key here…",
                            text: $vm.deepgramKeyDraft
                        )
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit { vm.saveDeepgramKey() }
                        HStack(spacing: 12) {
                            Button("Save Key") { vm.saveDeepgramKey() }
                                .disabled(vm.deepgramKeyDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                            if vm.deepgramKeySaved {
                                Label("Key saved", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                    .font(.caption)
                            }
                        }
                        Link("Get a free key at console.deepgram.com →",
                             destination: URL(string: "https://console.deepgram.com")!)
                            .font(.caption)
                    }

                    // iOS Shortcuts setup guide
                    DisclosureGroup(isExpanded: $shortcutsExpanded) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("iOS doesn't expose all notifications to apps. Use the Shortcuts app to automatically forward incoming messages:")
                                .foregroundStyle(.secondary)
                            Divider()
                            VStack(alignment: .leading, spacing: 4) {
                                Text("1. Open **Shortcuts** → Automations → +")
                                Text("2. Choose **Message** as the trigger")
                                Text("3. Enable **Run Immediately**, disable **Notify**")
                                Text("4. Add action: **Get Contents of URL**")
                                Text("   • URL: `http://127.0.0.1:7070/notifications`")
                                Text("   • Method: **POST** · Body type: **JSON**")
                                Text("   • Add fields: `from` = [Sender Name]")
                                Text("                `body` = [Message Content]")
                            }
                            .font(.caption)
                        }
                        .padding(.top, 4)
                    } label: {
                        Label("iOS Shortcuts Setup", systemImage: "arrow.triangle.branch")
                            .font(.subheadline)
                    }

                    // Test notification button
                    if vm.snapshot.running {
                        Button("Send Test Notification") {
                            vm.sendTestNotification()
                        }
                        .foregroundStyle(.accentColor)
                    }
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
