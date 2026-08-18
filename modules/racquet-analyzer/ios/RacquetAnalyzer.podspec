Pod::Spec.new do |s|
  s.name           = 'RacquetAnalyzer'
  s.version        = '0.1.0'
  s.summary        = 'On-device squash match analysis for RacquetIQ'
  s.description    = 'Decodes match video with AVAssetReader, runs Vision body pose, a 4-corner floor homography, audio onset shot detection, and emits the analysis.json (schemaVersion 1) contract on device.'
  s.author         = 'RacquetAI'
  s.homepage       = 'https://github.com/karanvirkhanna/RacquetAI'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'AVFoundation', 'Vision', 'CoreMedia', 'CoreVideo', 'ImageIO'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
