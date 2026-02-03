import React, { useCallback, useContext, useRef, useState, useEffect } from "react";
import {
  SpaceBetween,
  Container,
  Box,
  SegmentedControl,
  Input,
  FormField,
  Grid,
} from "@cloudscape-design/components";
import Button from "@cloudscape-design/components/button";
import customTranslations from "../../assets/i18n/all";
import Webcam from "react-webcam";
import ImageIngredients from "./recipe_image_ingredients";
import Select from "@cloudscape-design/components/select";
import Badge from "@cloudscape-design/components/badge";
import Link from "@cloudscape-design/components/link";
import { DevModeContext, LanguageContext } from "../app";
import FileUpload from "@cloudscape-design/components/file-upload";

const Recipe: React.FC = () => {
  const language = useContext(LanguageContext);
  const webcamRef = useRef<any>();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [myValue, setMyValue] = useState([]);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [selectedImgSrc, setSelectedImgSrc] = useState<string[]>([]);
  const [showWebcam, setShowWebcam] = useState(false);
  const [showOptionsButtons, setShowOptionsButtons] = useState(true);
  const [loadingVideoDevices, setLoadingVideoDevices] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<{
    value: string;
  } | null>(null);

  // Recipe context state
  const [recipeTime, setRecipeTime] = useState<any>({ label: "30 min", value: "30" });
  const [recipePeople, setRecipePeople] = useState<any>({ label: "4 people", value: "4" });
  const [recipeEquipment, setRecipeEquipment] = useState<any>({ label: "All", value: "all" });
  const [recipeBudget, setRecipeBudget] = useState<any>({ label: "$10", value: "10" });

  const { devMode } = useContext(DevModeContext);

  // Load recipe context from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("recipeContext");
    if (stored) {
      const context = JSON.parse(stored);
      setRecipeTime(context.time || { label: "30 min", value: "30" });
      setRecipePeople(context.people || { label: "4 people", value: "4" });
      setRecipeEquipment(context.equipment || { label: "All", value: "all" });
      setRecipeBudget(context.budget || { label: "$10", value: "10" });
    }
  }, []);

  // Save recipe context to localStorage
  useEffect(() => {
    const context = {
      time: recipeTime,
      people: recipePeople,
      equipment: recipeEquipment,
      budget: recipeBudget,
    };
    localStorage.setItem("recipeContext", JSON.stringify(context));
  }, [recipeTime, recipePeople, recipeEquipment, recipeBudget]);

  const loadSingleMockImage = async (imageNumber: number) => {
    const imgName = `fridge${imageNumber}.jpeg`;
    try {
      const imgPath = `/img/${imgName}`;
      const response = await fetch(imgPath);
      const blob = await response.blob();
      const reader = new FileReader();
      
      await new Promise((resolve) => {
        reader.onloadend = () => {
          if (reader.result) {
            setCapturedImages([reader.result as string]);
            setShowOptionsButtons(true);
          }
          resolve(null);
        };
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error(`Failed to load ${imgName}:`, error);
    }
  };

  const enumerateDevices = async () => {
    try {
      setLoadingVideoDevices(true);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      mediaStream.getTracks().forEach((track) => track.stop());
      const videoDevices = mediaDevices.filter(
        (device) => device.kind === "videoinput"
      );

      setDevices(videoDevices);
      const deviceId = videoDevices.filter((d) =>
        d.label.toLowerCase().includes("back")
      );
      if (deviceId.length > 0) {
        setSelectedDevice({
          value: deviceId[0].deviceId,
        });
      } else {
        setSelectedDevice({
          value: videoDevices[0].deviceId,
        });
      }
    } catch (error) {
      console.error("Error enumerating devices:", error);
    } finally {
      setLoadingVideoDevices(false);
    }
  };


function resizeBase64Image(base64Image: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create an Image element
    const image = new Image();
    image.src = base64Image;

    // Handle image load
    image.onload = () => {
      try {
        const resizedDataUrl = resizeImage(image, width, height);
        resolve(resizedDataUrl as string);
      } catch (error) {
        reject(error);
      }
    };

    // Handle image load error
    image.onerror = () => {
      reject("Failed to load image");
    };
  });
}
  function resizeImage(image: any, width: number, height: number) {
    // Create a canvas element
    
    const canvas = document.createElement("canvas");
    const ratio = image.height / image.width;
    // Set the canvas dimensions to the desired size
    canvas.width = width;
    canvas.height = height * ratio;
    console.log(canvas.width, canvas.height);
    // Get the 2D rendering context of the canvas
    const ctx = canvas.getContext("2d");

    if (ctx) {
      // Draw the image on the canvas, resizing it to the desired size

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);



    return canvas.toDataURL();;
    }
  }

  async function handleResize(imageSrc: string) {
    try {
      const resizedImage = await resizeBase64Image(imageSrc, 400, 400);
      setImgSrc(resizedImage ?? null);
    } catch (error) {
      console.error("Error resizing image:", error);
      setImgSrc(null);
    }
  }

  const capture = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current!.getScreenshot();
      handleResize(imageSrc);
      setShowWebcam(false);
      setShowOptionsButtons(true);
    }
  }, [webcamRef]);

  const addImage = () => {
    if (imgSrc) {
      setCapturedImages([...capturedImages, imgSrc]);
      setImgSrc(null);
      setShowOptionsButtons(true);
    }
  };

  const removeImage = (index: number) => {
    setCapturedImages(capturedImages.filter((_, i) => i !== index));
  };

  const startWebcam = () => {
    setSelectedImgSrc([]);
    setImgSrc(null);
    setShowWebcam(true);
    enumerateDevices();
  };

  const retake = () => {
    setImgSrc(null);
  };

  const useTheseImages = () => {
    const allImages = imgSrc ? [...capturedImages, imgSrc] : capturedImages;
    setSelectedImgSrc(allImages);
    setShowOptionsButtons(false);
  };

  const currentTranslations = customTranslations[language];

  const fileUploadOnChange = ({ detail }) => {
    setSelectedImgSrc([]);
    console.log(detail.value);
    const files = detail.value;
    if (files.length > 0) {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.src = reader.result as string;

        image.onload = () => {
          const resizedImage = resizeImage(image, 400, 400);
          setImgSrc(resizedImage ?? null);
          //console.log("resizedImage base 64");
          //console.log(resizedImage);
          setShowOptionsButtons(true);
        };
      };
      reader.readAsDataURL(files[0]);
    }
  };

  return (
    <div>
      <SpaceBetween direction="vertical" size="m">
        <Box>
          <div className="container">
            <SpaceBetween direction="vertical" size="s">
              {/* Render the button only when imgSrc is available */}
              {!showWebcam && (
                <div style={{ textAlign: "center" }}>
                  {!imgSrc && capturedImages.length === 0 && (
                    <div style={{
                      background: "linear-gradient(135deg, #00C853 0%, #64DD17 100%)",
                      borderRadius: "20px",
                      padding: "40px 20px",
                      marginBottom: "30px",
                      boxShadow: "0 10px 40px rgba(0, 200, 83, 0.25)",
                    }}>
                      <h1 style={{
                        fontSize: "2.5rem",
                        fontWeight: "700",
                        color: "#fff",
                        marginBottom: "10px",
                        textShadow: "0 2px 10px rgba(0,0,0,0.2)",
                      }}>
                        🛒 Shop Smarter with AI
                      </h1>
                      <p style={{
                        color: "rgba(255, 255, 255, 0.95)",
                        fontSize: "1.1rem",
                        marginBottom: "0",
                      }}>
                        Show us your fridge - we'll suggest recipes and add missing ingredients to your cart
                      </p>
                    </div>
                  )}
                  
                  {/* Recipe Context Form */}
                  {!imgSrc && capturedImages.length === 0 && (
                    <Container>
                      <SpaceBetween direction="vertical" size="s">
                        <h3 style={{ margin: "0 0 16px 0", color: "#333" }}>Recipe Context</h3>
                        <Grid gridDefinition={[{ colspan: 3 }, { colspan: 3 }, { colspan: 3 }, { colspan: 3 }]}>
                          <FormField label="Time">
                            <Select
                              selectedOption={recipeTime}
                              onChange={({ detail }) => setRecipeTime(detail.selectedOption)}
                              options={[
                                { label: "15 min", value: "15" },
                                { label: "30 min", value: "30" },
                                { label: "45 min", value: "45" },
                                { label: "60 min", value: "60" },
                                { label: "90+ min", value: "90" },
                              ]}
                            />
                          </FormField>
                          <FormField label="People">
                            <Select
                              selectedOption={recipePeople}
                              onChange={({ detail }) => setRecipePeople(detail.selectedOption)}
                              options={[
                                { label: "1 person", value: "1" },
                                { label: "2 people", value: "2" },
                                { label: "4 people", value: "4" },
                                { label: "6 people", value: "6" },
                                { label: "8+ people", value: "8" },
                              ]}
                            />
                          </FormField>
                          <FormField label="Equipment">
                            <Select
                              selectedOption={recipeEquipment}
                              onChange={({ detail }) => setRecipeEquipment(detail.selectedOption)}
                              options={[
                                { label: "All", value: "all" },
                                { label: "Stovetop only", value: "stovetop" },
                                { label: "Oven only", value: "oven" },
                                { label: "Microwave only", value: "microwave" },
                                { label: "No cooking", value: "none" },
                              ]}
                            />
                          </FormField>
                          <FormField label="Budget per person">
                            <Select
                              selectedOption={recipeBudget}
                              onChange={({ detail }) => setRecipeBudget(detail.selectedOption)}
                              options={[
                                { label: "$5", value: "5" },
                                { label: "$10", value: "10" },
                                { label: "$15", value: "15" },
                                { label: "$20", value: "20" },
                                { label: "$30+", value: "30" },
                              ]}
                            />
                          </FormField>
                        </Grid>
                      </SpaceBetween>
                    </Container>
                  )}
                  
                  {/* Sample fridge images - hero cards */}
                  {!imgSrc && capturedImages.length === 0 && (
                    <div style={{ marginBottom: "40px", marginTop: "30px" }}>
                      <div style={{ 
                        display: "grid", 
                        gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                        gap: "24px", 
                        maxWidth: "900px",
                        margin: "0 auto",
                        padding: "0 20px",
                      }}>
                        {[
                          { num: 1, title: "🥬 Fresh & Healthy" },
                          { num: 2, title: "🍖 Meal Prep Ready" },
                          { num: 3, title: "🍊 Family Favorites" }
                        ].map(({ num, title }) => (
                          <div
                            key={num}
                            onClick={() => loadSingleMockImage(num)}
                            style={{
                              position: "relative",
                              cursor: "pointer",
                              borderRadius: "16px",
                              overflow: "hidden",
                              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                              background: "#fff",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = "translateY(-8px) scale(1.02)";
                              e.currentTarget.style.boxShadow = "0 16px 48px rgba(0, 200, 83, 0.35)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = "translateY(0) scale(1)";
                              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.12)";
                            }}
                          >
                            <div style={{
                              position: "absolute",
                              top: "12px",
                              left: "12px",
                              right: "12px",
                              background: "rgba(255, 255, 255, 0.95)",
                              color: "#333",
                              padding: "8px 16px",
                              borderRadius: "12px",
                              fontSize: "1rem",
                              fontWeight: "700",
                              zIndex: 10,
                              backdropFilter: "blur(10px)",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                            }}>
                              {title}
                            </div>
                            <img
                              src={`/img/fridge${num}.jpeg`}
                              alt={title}
                              style={{
                                width: "100%",
                                height: "320px",
                                objectFit: "cover",
                                display: "block",
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Camera option - minimal, below cards */}
                  {!imgSrc && capturedImages.length === 0 && (
                    <div style={{
                      textAlign: "center",
                      padding: "20px",
                      borderTop: "1px solid #e0e0e0",
                      marginTop: "20px",
                    }}>
                      <p style={{ 
                        color: "#666", 
                        marginBottom: "12px",
                        fontSize: "0.95rem",
                      }}>
                        Or use your own ingredients
                      </p>
                      <Button 
                        variant="normal" 
                        onClick={startWebcam}
                      >
                        📷 Take Your Own Photo
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Conditionally render the image */}
              {capturedImages.length > 0 && !imgSrc && (
                <div style={{ textAlign: "center" }}>
                  <h4>{currentTranslations["recipe_captured_images"]} ({capturedImages.length})</h4>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center" }}>
                    {capturedImages.map((img, index) => (
                      <div key={index} style={{ position: "relative" }}>
                        <img
                          src={img}
                          style={{
                            borderRadius: "5px",
                            height: "150px",
                            objectFit: "cover",
                          }}
                        />
                        <Button
                          iconName="close"
                          variant="icon"
                          onClick={() => removeImage(index)}
                          ariaLabel="Remove image"
                        />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: "10px" }}>
                    <SpaceBetween direction="horizontal" size="s">
                      <Button onClick={startWebcam} variant="normal">
                        {currentTranslations["recipe_add_more"]}
                      </Button>
                      <Button onClick={useTheseImages} variant="primary">
                        {currentTranslations["recipe_generate_recipes"]}
                      </Button>
                    </SpaceBetween>
                  </div>
                </div>
              )}

              {imgSrc && (
                <>
                  <div style={{ textAlign: "center", maxHeight: "70vh" }}>
                    <img
                      src={imgSrc}
                      style={{
                        borderRadius: "5px",
                        display: "block",
                        margin: "auto",
                        height: "70vh",
                        maxWidth: "100%",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                  {showOptionsButtons && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        marginTop: "10px",
                      }}
                    >
                      <SpaceBetween direction="horizontal" size="s">
                        <Button onClick={retake} variant="normal">
                          {currentTranslations["recipe_retake_photo"]}
                        </Button>
                        <Button onClick={addImage} variant="normal">
                          {currentTranslations["recipe_add_image"]}
                        </Button>
                        <Button onClick={useTheseImages} variant="primary">
                          {capturedImages.length > 0 
                            ? currentTranslations["recipe_generate_recipes"]
                            : currentTranslations["recipe_use_this"]}
                        </Button>
                      </SpaceBetween>
                    </div>
                  )}
                </>
              )}
            </SpaceBetween>

            <div style={{ textAlign: "center" }}>
              {/* Conditionally render the retake and useThisImage buttons */}

              {/* Conditionally render the webcam or captured image */}
              {showWebcam && !imgSrc && (
                <div>
                  {loadingVideoDevices ? (
                    <div>{currentTranslations["recipe_search_video_src"]}</div>
                  ) : (
                    <div>
                      <SpaceBetween direction="vertical" size="m">
                        {devices.length > 1 && (
                          <div
                            style={{
                              justifyContent: "center",
                              display: "flex",
                            }}
                          >
                            <SegmentedControl
                              selectedId={selectedDevice?.value ?? null}
                              options={devices.map((device, index) => ({
                                text: device.label.replace(" Camera", ""),
                                id: device.deviceId,
                              }))}
                              onChange={({ detail }) => {
                                setSelectedDevice({
                                  value: detail.selectedId,
                                });
                              }}
                            />
                          </div>
                        )}

                        {selectedDevice && (
                          <SpaceBetween direction="vertical" size="m">
                            <div style={{ textAlign: "center", maxHeight: "70vh" }}>
                              <Webcam
                                audio={false}
                                videoConstraints={{
                                  deviceId: selectedDevice.value,
                                }}
                                ref={webcamRef}
                                style={{
                                  borderRadius: "5px",
                                  display: "block",
                                  margin: "auto",
                                  height: "70vh",
                                  maxWidth: "100%",
                                  objectFit: "contain",
                                }}
                                
                              />
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <Button onClick={capture} variant="primary">
                                {currentTranslations["recipe_take_picture"]}
                              </Button>
                            </div>
                          </SpaceBetween>
                        )}
                      </SpaceBetween>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Box>

        <div id="reader"></div>

        {selectedImgSrc.length > 0 && (
          <div>
            <ImageIngredients
              images={selectedImgSrc}
              language={language}
              recipeContext={{
                time: recipeTime?.value,
                people: recipePeople?.value,
                equipment: recipeEquipment?.value,
                budget: recipeBudget?.value,
              }}
              onRecipePropositionsDone={() => {
                setShowWebcam(false);
              }}
            />
          </div>
        )}
      </SpaceBetween>
    </div>
  );
};

export default Recipe;
