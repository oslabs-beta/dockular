import {stringToNumConverter as strToNumb} from '../utilities/StringToNumConverter'
import { totalStorageParser } from './totalStorageParser';
import { containerVirtualSizeConverterToString } from './ContainerVirtualSizeConverterToString';
import { checkBytesAndConvertToNumber } from '../utilities/ CheckBytesAndConvertToNumber';
import { roundTwoDecimalPlaces } from '../utilities/RoundTwoDecimalPlaces';


 async function GetAllStorage(CLI:any){
  const storage = {
    'unused-containers': 0, 
    'in-use-images' : 0,
    'dangling-images': 0,
    'unused-images': 0,
    'all-images': 0,
    'built-casche': 0,
    'combinedTotal': 0
  };


  //Tracks all ids of images.. We will start this out with all image ids and then remove in use image ids and dangling image ids as we obtain them. 
  const allImageIDTrackerSetForUnusedImages = new Set();

  const allImagesObj :any = {}; 
  //we want to keep a track of all the repositorys that are not equal to <none>. This assists us in parsing out which images are in use. 
  const allImageRepositoriesObj:any = {}; // {Repository:{ID, Size}}


  //set for all image repositories - attempt to increase performance
  const allImageRepositoriesSet = new Set(); 


  //track all unsused images data... will start will all images and will result into only unused images due to removing in use or dangling image ids 
  const getUnusedImgDataObj :any = {}; 
  //tracks data for dangling images -> dangling images can be both in use and dangling we need to seperate these because the user will have issues when pruning all at once in this category
  const getDanglingImageDataobj :any= {}; 
  //tracks data for in use images

  const allData:any = {storage: storage, data: {
    'in-use-images':[],
    'dangling-images': [], 
    'unused-images':  [], 
    'unused-containers': [], 
    'built-casche': [],
   }
  }

 

  
  //ALL IMAGES*******************************************************************************************************************************************************************************
  await CLI.docker.cli.exec('images', ['--format', '"{{json .}}"', '-a'])
  .then((result:any) => {
    // console.log('Dangling Result:', result)
    const AllImgs = result.parseJsonLines();
    AllImgs.forEach((el:any) => {
      // console.log('All Images ', el)

      //we only want to add to the allImageRepositoriesObj if the image repository within all the images has a repository name..we dont want the ones with <none>
      if(!el.Repository.match('<none>'))  {
        allImageRepositoriesObj[el.Repository] = {ID: el.ID, Size: el.Size}
        allImageRepositoriesSet.add(el.ID); 
      }

      //we need to have a list of all available images seperately to utlize in the code below when finding in use or dangling images. 
      allImagesObj[el.ID] = {ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince}

      //we want to fill the getUnusedImgDataObj with all images keys and values because we are going tbe deleting the values that are in use and or dangling in the code below. 
      getUnusedImgDataObj[el.ID] = {ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince}
      
      allImageIDTrackerSetForUnusedImages.add(el.ID)

      storage['all-images'] += checkBytesAndConvertToNumber(el.Size)
    })
  })
  

 

  // console.log('AllImageIDTrackerSet', allImageIDTrackerSetForUnusedImages)

  // console.log('ALL IMAGES - getUnusedImgDataObj', getUnusedImgDataObj)

  //IN USE IMAGES*******************************************************************************************************************************************************************************
   //we will utilise 'set' to make sure we dont have any repeated values. 
   //convert repostirories in allImagesInContainer to the shorter version .. mongo:latest -> mongo; The names of the images within the allImagesInContainer
   //could contain both a repository and a tag. --> repository:tag --> mongo:latest... lets remove the possibility of a tag and that way we can easily
   //compare both all images being used by Containers vs the repositories within the command that populates all the images. Assumption here is that 
   //the user will either create the container with the repository, repository:tag, or id... dont think they can create a container with just a tag. 
  const imgRepositoryConverterSet = new Set(); 
   
    //Set that contains allImagesUsedByConainer Ids
  const idsForallImagesUsedByContainerSet= new Set();
  
  
  //Get In use Image Repository or ID from the docker containers command. The command below does not offer data on Sizes etc .. except for the 
  //id or Repository of the image depending on how the user created the image (with id or repository)...We will get the ids of these running images and compare them to 
  //our full list of images to get the data for the images themselves. 

   await CLI.docker.cli.exec('ps', ['--format', '"{{json .}}"', '-a'])
   .then((result:any) => {

    // the images below could have repeated ids or names (which is why we utilize the set). It also doesnt distinguish whether the user created a container based off 
    // an id, repository, or repository:tag (mongo:latest)... We could run into the issue of users creating containers from these three categories and therefore having repeated
    //sizes adding up. Which is why we are going to convert all in use images to their ids first prior to doing anything with the data. We will not have a combination of
    // repository, repository:tag and ids. If a user created a container using the PostgreSQL image for ex., without specifying a tag, Docker will indeed default to using the 
    //latest tag. This behavior is because Docker assumes you want the latest version of the image if you don't specify a tag explicitly. 
     const allImagesUsedByContainer = result.parseJsonLines();

     //if index returns with -1 that could mean that either its a repostiory without a tag or an id.       
     allImagesUsedByContainer.forEach((el:any) => {
      const index = el.Image.indexOf(':')
      if(index !== -1){
        // console.log('el', el)
        imgRepositoryConverterSet.add(el.Image.slice(0, index))
      } else {
        idsForallImagesUsedByContainerSet.add(el.Image);
        // idsForallImagesUsedByContainer.add('mongo');
      }
     })

     //We need a command to add all the imgRepositoryConverterSet converted into ids into idsForallImagesUsedByContainerSet
     //we will loop through allImageRepositoriesObj and pass all the associated ids from the repository into idsForallImagesUsedByContainerSet
     for(let key in allImageRepositoriesObj){
      //if imgRepositoryConverterSet has the key (repository) from allImageRepositoriesObj then add the id into idsForallImagesUsedByContainerSet. Set will prevent
      //repeated values. 
        if(imgRepositoryConverterSet.has(key)) idsForallImagesUsedByContainerSet.add(allImageRepositoriesObj[key].ID)
     }


     //IF a user creates a container with just the repository name it will not automatically add a latest tag. We need to filter these scenerios out of our 
     //idsForallImagesUsedByContainerSet. Right now it will add the repository name in there as well because the indexOf will not catch any ':' and add it 
     //in this set. We need to convert this to its associated id. 

     //loop through our allImageRepositoriesObj which has keys of repository names
     for(let key in allImageRepositoriesObj){
      // console.log('KEY : allImageRepositoriesObj', key)
        if(idsForallImagesUsedByContainerSet.has(key)) {
          //if our idsForallImagesUsedByContainerSet has a repository delete the Repository Name
          idsForallImagesUsedByContainerSet.delete(key)
          //and add its associated id. 
          idsForallImagesUsedByContainerSet.add(allImageRepositoriesObj[key].ID)
        }
     }

    //  console.log('imgRepositoryConverter', imgRepositoryConverterSet)
    //  console.log('idsForallImagesUsedByContainer', idsForallImagesUsedByContainerSet)

    
  
    // allImagesObj[el.ID] = {ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince}
    for(let image in allImagesObj){
      if(idsForallImagesUsedByContainerSet.has(allImagesObj[image].ID)){
        //if the id within the allImagesObj exists within the idsForallImagesUsedByContainerSet(in use image ids) then add the size to storage['in-use-images']
        storage['in-use-images'] += checkBytesAndConvertToNumber(allImagesObj[image].Size);

        // id within all images matches the id within the inuse images fill the getInUseImageDataObj with all the inuse image data.
        // getInUseImageDataObj[allImagesObj[image].ID] = {ID: allImagesObj[image].ID, Size: allImagesObj[image].Size, Repository: allImagesObj[image].Repository, CreatedSince: allImagesObj[image].CreatedSince}
        allData.data['in-use-images'].push({ID: allImagesObj[image].ID, Size: allImagesObj[image].Size, Repository: allImagesObj[image].Repository, CreatedSince: allImagesObj[image].CreatedSince})
          
        //delete in use id key from getUnusedImgDataObj
        delete getUnusedImgDataObj[allImagesObj[image].ID]
      }
    }
   })

  //  console.log('IN USE - AllImageIDTrackerSet', allImageIDTrackerSetForUnusedImages)
  //  console.log('DELETE IN USE IMAGES - getUnusedImgDataObj', getUnusedImgDataObj)




  //Dangling Images****************************************************************************************************************************************************************************
  
   //lets create a seperate obj to track dangling images and then have a sperate piece of code remove the dangling image data. 

  await CLI.docker.cli.exec('images', ['--format', '"{{json .}}"', '--filter', "dangling=true"])
  .then((result:any) => {
    const danglingImg = result.parseJsonLines();
    // [el.ID] = {ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince
    
    danglingImg.forEach((el:any) => {
      getDanglingImageDataobj[el.ID] = {ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince}
      // allData.data['dangling-images'].push({ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince})
    })

    storage['dangling-images'] = danglingImg.reduce((sum:any,current:any)=>{

      //if the getUnusedImgDataObj has a dangling img id delete it from the obj
      // if(getUnusedImgDataObj[current.ID]) delete getUnusedImgDataObj[current.ID]; 


      //delete dangling image id from allImageIDTrackerSetForUnusedImages
      // allImageIDTrackerSetForUnusedImages.delete(current.ID)

      //delete in use id key from getUnusedImgDataObj
      delete getUnusedImgDataObj[current.ID]
      return sum + strToNumb(current.Size);
    }, 0);
  })

  //lets iterate through the in use image ids and remove the id we dont need from the dangling images. 

  idsForallImagesUsedByContainerSet.forEach((el:any) =>{
    //delete the in use dangling image from the getDanglingImageDataObj
    delete getDanglingImageDataobj[el];

    //delete in use id key from getUnusedImgDataObj
    delete getUnusedImgDataObj[el.ID]
  })

  //gets the most up to data dangling image data and pushes into alldata 
  for(let key in getDanglingImageDataobj) {
    // getDanglingImageDataobj[el.ID] = {ID: el.ID, Size: el.Size, Repository: el.Repository, CreatedSince: el.CreatedSince}
    allData.data['dangling-images'].push({
        ID: getDanglingImageDataobj[key].ID, 
        Size: getDanglingImageDataobj[key].Size, 
        Repository: getDanglingImageDataobj[key].Repository, 
        CreatedSince: getDanglingImageDataobj[key].CreatedSince
      })

  }

  // console.log('DANLING - allImageIDTrackerSet', allImageIDTrackerSetForUnusedImages)
  // console.log('DELETE Dangling IMAGES - getUnusedImgDataObj', getUnusedImgDataObj)


   //UNUSED IMAGES*************************************************************************************************************************************************************************
     

   //Now that we have all the ids and data from getUnusedImgDataObj. We can Aquire all of the sizes and data for all of these unused images. 
    for(let key in getUnusedImgDataObj){
      // console.log('checkBytesAndConvertToNumber(getUnusedImgDataObj[key].Size)', checkBytesAndConvertToNumber(getUnusedImgDataObj[key].Size))
      storage['unused-images'] += checkBytesAndConvertToNumber(getUnusedImgDataObj[key].Size)
      
      //fills all the data for the unused-images. 
      allData.data['unused-images'].push({ID: getUnusedImgDataObj[key].ID, Size: getUnusedImgDataObj[key].Size, Repository: getUnusedImgDataObj[key].Repository, CreatedSince: getUnusedImgDataObj[key].CreatedSince})
    }
   
    console.log("storage['unused-images']", storage['unused-images'] )

    // console.log('inUseAndDanglingIdObj',inUseAndDanglingIdObj)
    // console.log('inUseIdObj', inUseIdObj)
    // console.log('unusedImgDataArr', unusedImgDataArr)


  //Built Casche*************************************************************************************************************************************************************************

  await CLI.docker.cli.exec('builder', ['du', '--verbose'])
  .then((results:any) => {
    // console.log('build casche', results.parseJsonLines())
    // console.log('parseDockerBuilderDUOutput(results) -->', parseDockerBuilderDUOutput(results.stdout))
    storage['built-casche'] = totalStorageParser(results.stdout)
  })
  

  //Unused Containers*************************************************************************************************************************************************************************
  await CLI.docker.cli.exec('ps', ['--all', '--format', '"{{json .}}"', '--filter', "status=exited", '--filter', "status=paused", '--filter', "status=created"])
  .then((result:any) => {
    const unusedCont = result.parseJsonLines();
    //storage['unused-containers'] = 
    const containerSum =  unusedCont.reduce((sum:any,current:any)=>{ 
      const virtualStringConverter = containerVirtualSizeConverterToString(current.Size)
      //The checkBytesAndConvertToNumber function checks the type of Bytes (kb, mb, gb or byte) & converts to megabytes 
      //in the form of a number */
      // console.log('checkBytesAndConvertToNumber(virtualStringConverter) ', checkBytesAndConvertToNumber(virtualStringConverter) )
      return sum + checkBytesAndConvertToNumber(virtualStringConverter) 
    }, 0)

    // storage['unused-containers'] = containerSum;
    storage['unused-containers'] = roundTwoDecimalPlaces(containerSum);
    // console.log("storage['unused-containers']", storage['unused-containers'])
    // console.log('roundThreeDecimalPlaces', roundTwoDecimalPlaces(containerSum))
  })

  // console.log("storage['unused-containers']", storage['unused-containers'])

  storage['combinedTotal'] = storage['dangling-images'] + storage['unused-containers'] + storage['built-casche']

  // console.log('allData', allData)
  // return allData; 
  return storage;
}

export default GetAllStorage;

