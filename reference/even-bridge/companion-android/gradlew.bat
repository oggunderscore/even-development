@echo off
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%
"%JAVA_HOME%\bin\java" -jar "%~dp0gradle\wrapper\gradle-wrapper.jar" %*
