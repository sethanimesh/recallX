rm -rf ~/Library/Developer/Xcode/DerivedDataRecallX-*

xcodebuild   -workspace ios/RecallX.xcworkspace   -scheme RecallX   -configuration Debug   -destination id=00008130-000839603CC0001C   DEVELOPMENT_TEAM=L5WYQUPZPS   -allowProvisioningUpdates   -allowProvisioningDeviceRegistration   build

npx expo run:ios --configuration Release --device