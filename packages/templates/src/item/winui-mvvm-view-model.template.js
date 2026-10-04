import { generateMvvmItem } from "./winui-mvvm.js";

export const order = 71;
export const template = Object.freeze({
  "id": "winui-mvvm-view-model",
  "name": "Observable View Model and RelayCommand",
  "description": "INotifyPropertyChanged and ICommand with no external MVVM dependency.",
  "category": "WinUI MVVM",
  "language": "C#",
  "platform": ".NET SDK",
  "kind": "item",
  "windowsOnly": false,
  "nativeOnly": true,
  "targets": [
    "native-dotnet",
    "windows-native"
  ],
  "prerequisites": [
    "Native .NET SDK with INotifyPropertyChanged and ICommand"
  ],
  "qualification": {
    "windows-native": "pending"
  },
  "fileName": "MainViewModel.cs",
  generate: generateMvvmItem
});
