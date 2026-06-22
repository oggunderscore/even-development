 const sendImageWithCenteredText = async (imagePath: string, text: string, font : string, fontSize : string): Promise<void> => {

        const response = await fetch(imagePath);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const canvas = document.createElement("canvas");
        canvas.width = 288;
        canvas.height = 144;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
            throw new Error("Could not obtain 2D rendering context.");
        }

        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

          ctx.font = ${fontSize} ${font}; // Adjust font size/family as needed for a 288x144 canvas
        ctx.fillStyle = "green";       // Text color
        ctx.textAlign = "center";      // Horizontal center alignment
        ctx.textBaseline = "middle";   // Vertical center alignment
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        ctx.fillText(text, centerX, centerY);

        // 6. Convert canvas to png blob and extract Uint8Array
        const pngBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(b => {
                if (b) resolve(b);
                else reject(new Error("Canvas toBlob failed"));
            }, "image/png");
        });

        const arrayBuffer = await pngBlob.arrayBuffer();
        const imageData = new Uint8Array(arrayBuffer);

        // 7. Package and send via your SDK
        const payload = new ImageRawDataUpdate({
            containerID: 101,
            imageData: imageData,
        });

        await bridge.updateImageRawData(payload);
    };

await sendImageWithCenteredText("/background.png", inputText.value, font.value, fontSize.value);